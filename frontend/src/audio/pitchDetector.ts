export interface PitchDetectorOptions {
  minimumFrequency?: number;
  maximumFrequency?: number;
  threshold?: number;
  minimumRms?: number;
}

const DEFAULT_OPTIONS = {
  minimumFrequency: 70,
  maximumFrequency: 1_000,
  threshold: 0.14,
  minimumRms: 0.012,
} satisfies Required<PitchDetectorOptions>;

/**
 * Estimate a monophonic fundamental frequency with the YIN difference method.
 * Returns null for silence, noisy/unreliable frames, or out-of-range pitches.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchDetectorOptions = {},
): number | null {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (samples.length < 256 || sampleRate <= 0) {
    return null;
  }

  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) {
    mean += samples[index];
  }
  mean /= samples.length;

  let squaredTotal = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean;
    squaredTotal += centered * centered;
  }
  const rms = Math.sqrt(squaredTotal / samples.length);
  if (rms < config.minimumRms) {
    return null;
  }

  const minimumTau = Math.max(2, Math.floor(sampleRate / config.maximumFrequency));
  const maximumTau = Math.min(
    Math.floor(sampleRate / config.minimumFrequency),
    Math.floor(samples.length / 2),
  );
  if (minimumTau >= maximumTau) {
    return null;
  }

  const differences = new Float32Array(maximumTau + 1);
  const comparisonLength = samples.length - maximumTau;
  for (let tau = 1; tau <= maximumTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = samples[index] - samples[index + tau];
      sum += delta * delta;
    }
    differences[tau] = sum;
  }

  const normalized = new Float32Array(maximumTau + 1);
  normalized[0] = 1;
  let runningTotal = 0;
  for (let tau = 1; tau <= maximumTau; tau += 1) {
    runningTotal += differences[tau];
    normalized[tau] = runningTotal === 0 ? 1 : (differences[tau] * tau) / runningTotal;
  }

  let selectedTau = -1;
  for (let tau = minimumTau; tau < maximumTau; tau += 1) {
    if (normalized[tau] >= config.threshold) {
      continue;
    }
    selectedTau = tau;
    while (
      selectedTau + 1 <= maximumTau &&
      normalized[selectedTau + 1] < normalized[selectedTau]
    ) {
      selectedTau += 1;
    }
    break;
  }

  if (selectedTau < 0) {
    let bestValue = 1;
    for (let tau = minimumTau; tau <= maximumTau; tau += 1) {
      if (normalized[tau] < bestValue) {
        bestValue = normalized[tau];
        selectedTau = tau;
      }
    }
    if (bestValue > 0.32) {
      return null;
    }
  }

  const refinedTau = parabolicMinimum(normalized, selectedTau);
  const frequency = sampleRate / refinedTau;
  return frequency >= config.minimumFrequency && frequency <= config.maximumFrequency
    ? frequency
    : null;
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function parabolicMinimum(values: Float32Array, index: number): number {
  if (index <= 0 || index >= values.length - 1) {
    return index;
  }
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const denominator = left - 2 * center + right;
  if (Math.abs(denominator) < 1e-8) {
    return index;
  }
  const offset = 0.5 * (left - right) / denominator;
  return index + Math.max(-1, Math.min(1, offset));
}
