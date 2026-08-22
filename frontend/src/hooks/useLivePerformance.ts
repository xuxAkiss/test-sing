import { useCallback, useEffect, useRef, useState } from "react";

import { compensatePlaybackTime } from "../audio/latencyCalibration";
import type { LivePitchPoint, ReferencePitchResponse } from "../types";
import {
  foldMidiToReferenceOctave,
  referenceMidiNearTime,
} from "../utils/pitchView";

type LiveSessionStatus =
  | "preflight"
  | "requesting"
  | "countdown"
  | "recording"
  | "stopping";

interface UseLivePerformanceOptions {
  fallbackDuration: number;
  playbackStartSeconds?: number;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  latencyMs?: number;
  referencePitch?: ReferencePitchResponse;
  onComplete: (recording: File) => Promise<void> | void;
}

interface LivePerformanceSession {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  status: LiveSessionStatus;
  error: string | null;
  currentTime: number;
  duration: number;
  pitchPoints: LivePitchPoint[];
  currentMidi: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  updateDuration: (duration: number) => void;
}

type PitchModule = typeof import("../audio/pitchDetector");
type AudioContextConstructor = typeof AudioContext;

const ANALYSIS_INTERVAL_MS = 80;
const VISIBLE_PITCH_SECONDS = 22;

export function useLivePerformance({
  fallbackDuration,
  rangeStartSeconds,
  playbackStartSeconds = rangeStartSeconds,
  rangeEndSeconds,
  latencyMs = 0,
  referencePitch,
  onComplete,
}: UseLivePerformanceOptions): LivePerformanceSession {
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pitchModuleRef = useRef<PitchModule | null>(null);
  const recordingResultRef = useRef<Promise<File> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const stopActionRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef<LiveSessionStatus>("preflight");
  const mountedRef = useRef(true);
  const playbackStartRef = useRef(playbackStartSeconds);
  const rangeStartRef = useRef(rangeStartSeconds);
  const latencyMsRef = useRef(latencyMs);
  const referencePitchRef = useRef(referencePitch);
  const onCompleteRef = useRef(onComplete);
  const [status, setStatus] = useState<LiveSessionStatus>("preflight");
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(rangeStartSeconds);
  const [duration, setDuration] = useState(fallbackDuration);
  const [pitchPoints, setPitchPoints] = useState<LivePitchPoint[]>([]);
  const [currentMidi, setCurrentMidi] = useState<number | null>(null);

  const changeStatus = useCallback((nextStatus: LiveSessionStatus): void => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    playbackStartRef.current = playbackStartSeconds;
    rangeStartRef.current = rangeStartSeconds;
    if (statusRef.current === "preflight") {
      setCurrentTime(rangeStartSeconds);
    }
  }, [playbackStartSeconds, rangeStartSeconds]);

  useEffect(() => {
    latencyMsRef.current = latencyMs;
  }, [latencyMs]);

  useEffect(() => {
    referencePitchRef.current = referencePitch;
  }, [referencePitch]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const cancelAnalysis = useCallback((): void => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const releaseMedia = useCallback((): void => {
    cancelAnalysis();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    recorderRef.current = null;
    recordingResultRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    const audioContext = audioContextRef.current;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }
    audioContextRef.current = null;
  }, [cancelAnalysis]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseMedia();
    };
  }, [releaseMedia]);

  const startAnalysis = useCallback((): void => {
    const analyser = analyserRef.current;
    const audioContext = audioContextRef.current;
    const audio = audioRef.current;
    const pitchModule = pitchModuleRef.current;
    if (!analyser || !audioContext || !audio || !pitchModule) {
      return;
    }
    const samples = new Float32Array(analyser.fftSize);
    let lastAnalyzedAt = -ANALYSIS_INTERVAL_MS;
    let previousMidi: number | null = null;
    let unvoicedFrames = 0;

    const analyze = (timestamp: number): void => {
      if (statusRef.current !== "recording") {
        return;
      }
      if (timestamp - lastAnalyzedAt >= ANALYSIS_INTERVAL_MS) {
        lastAnalyzedAt = timestamp;
        analyser.getFloatTimeDomainData(samples);
        const frequency = pitchModule.detectPitch(samples, audioContext.sampleRate);
        const playbackTime = compensatePlaybackTime(
          audio.currentTime,
          latencyMsRef.current,
          rangeStartRef.current,
        );
        const rawMidi =
          frequency === null ? null : pitchModule.frequencyToMidi(frequency);
        let midi: number | null = null;
        if (rawMidi !== null) {
          const localReference = referencePitchRef.current
            ? referenceMidiNearTime(referencePitchRef.current, playbackTime)
            : null;
          midi = foldMidiToReferenceOctave(
            rawMidi,
            localReference,
            previousMidi,
          );
          previousMidi = midi;
          unvoicedFrames = 0;
        } else {
          unvoicedFrames += 1;
          if (unvoicedFrames >= 5) {
            previousMidi = null;
          }
        }
        setCurrentTime(playbackTime);
        setCurrentMidi(midi);
        setPitchPoints((current) => {
          const cutoff = Math.max(
            rangeStartRef.current,
            playbackTime - VISIBLE_PITCH_SECONDS,
          );
          const visible = current.filter((point) => point.time >= cutoff);
          return [...visible, { time: playbackTime, midi }];
        });
      }
      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    animationFrameRef.current = requestAnimationFrame(analyze);
  }, []);

  const startCountdown = useCallback((): void => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const updateCountdown = (): void => {
      if (statusRef.current !== "countdown") {
        return;
      }
      const playbackTime = Math.min(audio.currentTime, rangeStartRef.current);
      setCurrentTime(playbackTime);
      if (audio.currentTime >= rangeStartRef.current - 0.02) {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === "inactive") {
          recorder.start(1_000);
        }
        setCurrentTime(rangeStartRef.current);
        setPitchPoints([]);
        setCurrentMidi(null);
        changeStatus("recording");
        startAnalysis();
        return;
      }
      animationFrameRef.current = requestAnimationFrame(updateCountdown);
    };
    animationFrameRef.current = requestAnimationFrame(updateCountdown);
  }, [changeStatus, startAnalysis]);

  const start = useCallback(async (): Promise<void> => {
    const supportIssue = getLiveRecordingSupportIssue();
    if (supportIssue) {
      setError(supportIssue);
      return;
    }
    const audio = audioRef.current;
    const AudioContextClass = getAudioContextConstructor();
    if (!audio || !AudioContextClass) {
      setError("浏览器未能初始化实时音频，请上传已有录音。");
      return;
    }

    setError(null);
    setPitchPoints([]);
    setCurrentMidi(null);
    setCurrentTime(rangeStartRef.current);
    changeStatus("requesting");

    let stream: MediaStream | null = null;
    try {
      const pitchModulePromise = import("../audio/pitchDetector");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      const pitchModule = await pitchModulePromise;
      if (!mountedRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;
      pitchModuleRef.current = pitchModule;
      const audioContext = new AudioContextClass({ latencyHint: "interactive" });
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4_096;
      analyser.smoothingTimeConstant = 0.08;
      sourceNode.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorderRef.current = recorder;
      recordingResultRef.current = new Promise<File>((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        });
        recorder.addEventListener(
          "error",
          () => reject(new Error("浏览器录音失败，请重试或上传已有录音。")),
          { once: true },
        );
        recorder.addEventListener(
          "stop",
          () => {
            const type = recorder.mimeType || chunks[0]?.type || "audio/webm";
            const blob = new Blob(chunks, { type });
            if (blob.size === 0) {
              reject(new Error("没有录到声音，请检查麦克风后重试。"));
              return;
            }
            resolve(
              new File([blob], `live-performance.${extensionForMimeType(type)}`, {
                type,
              }),
            );
          },
          { once: true },
        );
      });

      const playbackStart = Math.min(
        rangeStartRef.current,
        Math.max(0, playbackStartRef.current),
      );
      const hasCountdown = playbackStart < rangeStartRef.current - 0.05;
      audio.currentTime = playbackStart;
      setCurrentTime(playbackStart);
      if (!hasCountdown) {
        recorder.start(1_000);
      }
      changeStatus(hasCountdown ? "countdown" : "recording");
      await audio.play();
      if (hasCountdown) {
        startCountdown();
      } else {
        startAnalysis();
      }
    } catch (reason) {
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      releaseMedia();
      changeStatus("preflight");
      setError(microphoneErrorMessage(reason));
    }
  }, [changeStatus, releaseMedia, startAnalysis, startCountdown]);

  const performStop = useCallback(async (): Promise<void> => {
    if (statusRef.current === "countdown") {
      releaseMedia();
      setCurrentTime(rangeStartRef.current);
      setPitchPoints([]);
      setCurrentMidi(null);
      changeStatus("preflight");
      return;
    }
    if (statusRef.current !== "recording") {
      return;
    }
    changeStatus("stopping");
    cancelAnalysis();
    audioRef.current?.pause();
    const recorder = recorderRef.current;
    const recordingResult = recordingResultRef.current;
    if (!recorder || !recordingResult) {
      releaseMedia();
      changeStatus("preflight");
      setError("没有可提交的录音，请重新开始。");
      return;
    }

    try {
      if (recorder.state !== "inactive") {
        recorder.requestData();
        recorder.stop();
      }
      const recording = await recordingResult;
      releaseMedia();
      await onCompleteRef.current(recording);
    } catch (reason) {
      releaseMedia();
      changeStatus("preflight");
      setError(microphoneErrorMessage(reason));
    }
  }, [cancelAnalysis, changeStatus, releaseMedia]);

  const stop = useCallback(async (): Promise<void> => {
    if (stopActionRef.current) {
      return stopActionRef.current;
    }
    const action = performStop().finally(() => {
      stopActionRef.current = null;
    });
    stopActionRef.current = action;
    return action;
  }, [performStop]);

  const updateDuration = useCallback((nextDuration: number): void => {
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration);
    }
  }, []);

  useEffect(() => {
    if (
      status === "recording" &&
      currentTime >= rangeEndSeconds - 0.05
    ) {
      void stop();
    }
  }, [currentTime, rangeEndSeconds, status, stop]);

  return {
    audioRef,
    status,
    error,
    currentTime,
    duration,
    pitchPoints,
    currentMidi,
    start,
    stop,
    updateDuration,
  };
}

export function getLiveRecordingSupportIssue(): string | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "当前环境不支持实时演唱，请上传已有录音。";
  }
  if (window.isSecureContext === false) {
    return "实时演唱需要 HTTPS 安全连接；当前仍可上传已有录音。";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "当前浏览器无法访问麦克风，请使用最新版 Chrome 或 Safari。";
  }
  if (typeof MediaRecorder === "undefined") {
    return "当前浏览器不支持录音，请上传已有录音。";
  }
  if (!getAudioContextConstructor()) {
    return "当前浏览器不支持实时音高检测，请上传已有录音。";
  }
  return null;
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const extendedWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? extendedWindow.webkitAudioContext ?? null;
}

function preferredRecordingMimeType(): string | undefined {
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function extensionForMimeType(mimeType: string): "m4a" | "ogg" | "webm" {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

function microphoneErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === "NotAllowedError" || reason.name === "SecurityError") {
      return "没有获得麦克风权限。请在浏览器设置中允许后重试，或上传已有录音。";
    }
    if (reason.name === "NotFoundError" || reason.name === "DevicesNotFoundError") {
      return "没有检测到可用的麦克风，请连接设备后重试。";
    }
    if (reason.name === "NotReadableError" || reason.name === "TrackStartError") {
      return "麦克风正被其他应用占用，请关闭占用后重试。";
    }
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  return "实时录音没有成功，请重试或上传已有录音。";
}
