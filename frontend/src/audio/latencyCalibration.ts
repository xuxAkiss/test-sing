export interface LatencyEstimate {
  delayMs: number;
  confidence: number;
}

export interface LatencyCalibrationResult extends LatencyEstimate {
  spreadMs: number;
  measuredAt: number;
}

interface CapturedChunk {
  frame: number;
  samples: Float32Array;
}

type AudioContextConstructor = typeof AudioContext;

const ANALYSIS_SAMPLE_RATE = 4_000;
const MINIMUM_DELAY_MS = 15;
const MAXIMUM_DELAY_MS = 650;
const MINIMUM_CONFIDENCE = 0.1;
const MAXIMUM_SPREAD_MS = 80;
const ROUND_SPACING_SECONDS = 0.95;
const CALIBRATION_ROUNDS = 3;
export const LATENCY_CALIBRATION_STORAGE_KEY =
  "karaoke-pitch-lab:latency-calibration:v1";
const STORAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export function createCalibrationSignal(sampleRate: number): Float32Array {
  const durationSeconds = 0.32;
  const burstSeconds = 0.055;
  const burstStarts = [0.015, 0.13, 0.245];
  const samples = new Float32Array(Math.ceil(durationSeconds * sampleRate));
  for (const burstStart of burstStarts) {
    const start = Math.round(burstStart * sampleRate);
    const length = Math.round(burstSeconds * sampleRate);
    let phase = 0;
    for (let offset = 0; offset < length && start + offset < samples.length; offset += 1) {
      const progress = offset / Math.max(1, length - 1);
      const frequency = 1_300 + 2_400 * progress;
      phase += (2 * Math.PI * frequency) / sampleRate;
      const envelope = Math.sin(Math.PI * progress) ** 2;
      samples[start + offset] += Math.sin(phase) * envelope * 0.2;
    }
  }
  return samples;
}

export function compensatePlaybackTime(
  playbackTimeSeconds: number,
  delayMs: number,
  minimumSeconds = 0,
): number {
  const safeDelayMs = Number.isFinite(delayMs)
    ? Math.max(0, Math.min(MAXIMUM_DELAY_MS, delayMs))
    : 0;
  return Math.max(minimumSeconds, playbackTimeSeconds - safeDelayMs / 1_000);
}

export function estimateLatency(
  reference: Float32Array,
  recording: Float32Array,
  sampleRate: number,
  expectedStartSample: number,
  minimumDelayMs = MINIMUM_DELAY_MS,
  maximumDelayMs = MAXIMUM_DELAY_MS,
): LatencyEstimate {
  if (sampleRate <= 0 || reference.length === 0 || recording.length === 0) {
    return { delayMs: 0, confidence: 0 };
  }
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_SAMPLE_RATE));
  const analysisRate = sampleRate / factor;
  const template = downsample(reference, factor);
  const captured = downsample(recording, factor);
  const expectedStart = Math.round(expectedStartSample / factor);
  const minimumIndex = Math.max(
    0,
    expectedStart + Math.round((minimumDelayMs / 1_000) * analysisRate),
  );
  const maximumIndex = Math.min(
    captured.length - template.length,
    expectedStart + Math.round((maximumDelayMs / 1_000) * analysisRate),
  );
  if (maximumIndex < minimumIndex || template.length < 8) {
    return { delayMs: 0, confidence: 0 };
  }

  const templateMean = mean(template);
  const centeredTemplate = new Float32Array(template.length);
  let templateEnergy = 0;
  for (let index = 0; index < template.length; index += 1) {
    const value = template[index] - templateMean;
    centeredTemplate[index] = value;
    templateEnergy += value * value;
  }
  if (templateEnergy <= 1e-12) {
    return { delayMs: 0, confidence: 0 };
  }

  const prefix = new Float64Array(captured.length + 1);
  const prefixSquares = new Float64Array(captured.length + 1);
  for (let index = 0; index < captured.length; index += 1) {
    const value = captured[index];
    prefix[index + 1] = prefix[index] + value;
    prefixSquares[index + 1] = prefixSquares[index] + value * value;
  }

  let bestIndex = minimumIndex;
  let bestCorrelation = -1;
  for (let start = minimumIndex; start <= maximumIndex; start += 1) {
    const end = start + template.length;
    const windowSum = prefix[end] - prefix[start];
    const windowMean = windowSum / template.length;
    const windowEnergy = Math.max(
      0,
      prefixSquares[end] - prefixSquares[start] -
        template.length * windowMean * windowMean,
    );
    if (windowEnergy <= 1e-12) {
      continue;
    }
    let correlation = 0;
    for (let offset = 0; offset < centeredTemplate.length; offset += 1) {
      correlation +=
        centeredTemplate[offset] * (captured[start + offset] - windowMean);
    }
    const normalized = correlation / Math.sqrt(templateEnergy * windowEnergy);
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestIndex = start;
    }
  }

  return {
    delayMs: ((bestIndex - expectedStart) / analysisRate) * 1_000,
    confidence: Math.max(0, Math.min(1, bestCorrelation)),
  };
}

export function combineLatencyEstimates(
  estimates: LatencyEstimate[],
  measuredAt = Date.now(),
): LatencyCalibrationResult {
  const reliable = estimates.filter(
    (estimate) =>
      Number.isFinite(estimate.delayMs) && estimate.confidence >= MINIMUM_CONFIDENCE,
  );
  if (reliable.length < 2) {
    throw new Error("没有清楚检测到校准音，请调高音量并保持环境安静后重试。");
  }
  const delays = reliable.map((estimate) => estimate.delayMs).sort((a, b) => a - b);
  const spreadMs = delays.at(-1)! - delays[0];
  if (spreadMs > MAXIMUM_SPREAD_MS) {
    throw new Error("三次测量差异较大，请保持手机与扬声器位置不变后重试。");
  }
  return {
    delayMs: Math.round(median(delays)),
    confidence: median(
      reliable.map((estimate) => estimate.confidence).sort((a, b) => a - b),
    ),
    spreadMs: Math.round(spreadMs),
    measuredAt,
  };
}

export async function measureRoundTripLatency(
  stream: MediaStream,
  AudioContextClass: AudioContextConstructor,
): Promise<LatencyCalibrationResult> {
  const context = new AudioContextClass({ latencyHint: "interactive" });
  let capture: CalibrationCapture | null = null;
  try {
    await context.resume();
    capture = await CalibrationCapture.create(context, stream);
    const signal = createCalibrationSignal(context.sampleRate);
    const startTime = context.currentTime + 0.3;
    const scheduledFrames: number[] = [];
    for (let round = 0; round < CALIBRATION_ROUNDS; round += 1) {
      const scheduledTime = startTime + round * ROUND_SPACING_SECONDS;
      scheduledFrames.push(Math.round(scheduledTime * context.sampleRate));
      const buffer = context.createBuffer(1, signal.length, context.sampleRate);
      buffer.getChannelData(0).set(signal);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(scheduledTime);
    }

    const finishTime =
      startTime +
      (CALIBRATION_ROUNDS - 1) * ROUND_SPACING_SECONDS +
      signal.length / context.sampleRate +
      MAXIMUM_DELAY_MS / 1_000 +
      0.15;
    await wait(Math.max(0, finishTime - context.currentTime) * 1_000);
    const captured = capture.finish();
    const estimates = scheduledFrames.map((scheduledFrame) =>
      estimateLatency(
        signal,
        captured.samples,
        context.sampleRate,
        scheduledFrame - captured.startFrame,
      ),
    );
    return combineLatencyEstimates(estimates);
  } finally {
    capture?.dispose();
    if (context.state !== "closed") {
      await context.close();
    }
  }
}

export function loadStoredLatencyCalibration(
  storage: Storage,
  userAgent: string,
  now = Date.now(),
): LatencyCalibrationResult | null {
  try {
    const raw = storage.getItem(LATENCY_CALIBRATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as LatencyCalibrationResult & {
      userAgent?: string;
    };
    if (
      payload.userAgent !== userAgent ||
      !Number.isFinite(payload.delayMs) ||
      !Number.isFinite(payload.confidence) ||
      !Number.isFinite(payload.spreadMs) ||
      !Number.isFinite(payload.measuredAt) ||
      now - payload.measuredAt > STORAGE_MAX_AGE_MS ||
      now < payload.measuredAt
    ) {
      return null;
    }
    return {
      delayMs: payload.delayMs,
      confidence: payload.confidence,
      spreadMs: payload.spreadMs,
      measuredAt: payload.measuredAt,
    };
  } catch {
    return null;
  }
}

export function storeLatencyCalibration(
  storage: Storage,
  userAgent: string,
  result: LatencyCalibrationResult,
): void {
  storage.setItem(
    LATENCY_CALIBRATION_STORAGE_KEY,
    JSON.stringify({ ...result, userAgent }),
  );
}

class CalibrationCapture {
  private chunks: CapturedChunk[] = [];
  private finished = false;

  private constructor(
    private readonly source: MediaStreamAudioSourceNode,
    private readonly captureNode: AudioNode,
    private readonly silentGain: GainNode,
    private readonly moduleUrl: string | null,
    private readonly detach: () => void,
  ) {}

  static async create(
    context: AudioContext,
    stream: MediaStream,
  ): Promise<CalibrationCapture> {
    const source = context.createMediaStreamSource(stream);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      const moduleUrl = URL.createObjectURL(
        new Blob([audioWorkletSource()], { type: "text/javascript" }),
      );
      await context.audioWorklet.addModule(moduleUrl);
      const node = new AudioWorkletNode(context, "latency-calibration-capture");
      const capture = new CalibrationCapture(
        source,
        node,
        silentGain,
        moduleUrl,
        () => {
          node.port.onmessage = null;
        },
      );
      node.port.onmessage = (event: MessageEvent<CapturedChunk>) => {
        capture.addChunk(event.data.frame, event.data.samples);
      };
      source.connect(node).connect(silentGain).connect(context.destination);
      return capture;
    }

    const node = context.createScriptProcessor(1_024, 1, 1);
    const capture = new CalibrationCapture(
      source,
      node,
      silentGain,
      null,
      () => {
        node.onaudioprocess = null;
      },
    );
    node.onaudioprocess = (event) => {
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      const frame = Math.round(event.playbackTime * context.sampleRate);
      capture.addChunk(frame, samples);
    };
    source.connect(node).connect(silentGain).connect(context.destination);
    return capture;
  }

  addChunk(frame: number, samples: Float32Array): void {
    if (!this.finished && samples.length > 0) {
      this.chunks.push({ frame, samples: new Float32Array(samples) });
    }
  }

  finish(): { startFrame: number; samples: Float32Array } {
    this.finished = true;
    if (this.chunks.length === 0) {
      throw new Error("浏览器没有返回校准录音，请重试或直接开始演唱。");
    }
    const startFrame = Math.min(...this.chunks.map((chunk) => chunk.frame));
    const endFrame = Math.max(
      ...this.chunks.map((chunk) => chunk.frame + chunk.samples.length),
    );
    const samples = new Float32Array(endFrame - startFrame);
    for (const chunk of this.chunks) {
      samples.set(chunk.samples, chunk.frame - startFrame);
    }
    return { startFrame, samples };
  }

  dispose(): void {
    this.detach();
    this.source.disconnect();
    this.captureNode.disconnect();
    this.silentGain.disconnect();
    if (this.moduleUrl) {
      URL.revokeObjectURL(this.moduleUrl);
    }
  }
}

function downsample(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) {
    return samples;
  }
  const result = new Float32Array(Math.floor(samples.length / factor));
  for (let output = 0; output < result.length; output += 1) {
    let total = 0;
    const start = output * factor;
    for (let offset = 0; offset < factor; offset += 1) {
      total += samples[start + offset];
    }
    result[output] = total / factor;
  }
  return result;
}

function mean(values: Float32Array): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / Math.max(1, values.length);
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function audioWorkletSource(): string {
  return `
class LatencyCalibrationCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      const samples = new Float32Array(channel);
      this.port.postMessage({ frame: currentFrame, samples }, [samples.buffer]);
    }
    return true;
  }
}
registerProcessor("latency-calibration-capture", LatencyCalibrationCaptureProcessor);
`;
}
