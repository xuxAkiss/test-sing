import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadStoredLatencyCalibration,
  measureRoundTripLatency,
  storeLatencyCalibration,
  type LatencyCalibrationResult,
} from "../audio/latencyCalibration";

export type LatencyCalibrationStatus = "idle" | "calibrating" | "ready" | "failed";

interface LatencyCalibrationSession {
  status: LatencyCalibrationStatus;
  result: LatencyCalibrationResult | null;
  error: string | null;
  calibrate: () => Promise<void>;
}

type AudioContextConstructor = typeof AudioContext;

export function useLatencyCalibration(): LatencyCalibrationSession {
  const mountedRef = useRef(true);
  const [result, setResult] = useState<LatencyCalibrationResult | null>(() =>
    storedCalibration(),
  );
  const [status, setStatus] = useState<LatencyCalibrationStatus>(
    result ? "ready" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const calibrate = useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("failed");
      setError("当前浏览器无法访问麦克风，请直接开始演唱或上传已有录音。");
      return;
    }
    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) {
      setStatus("failed");
      setError("当前浏览器不支持精确音频校准，可以直接开始演唱。");
      return;
    }

    setStatus("calibrating");
    setError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const measured = await measureRoundTripLatency(stream, AudioContextClass);
      if (!mountedRef.current) {
        return;
      }
      storeLatencyCalibration(window.localStorage, navigator.userAgent, measured);
      setResult(measured);
      setStatus("ready");
    } catch (reason) {
      if (!mountedRef.current) {
        return;
      }
      setStatus("failed");
      setError(calibrationErrorMessage(reason));
    } finally {
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
    }
  }, []);

  return { status, result, error, calibrate };
}

function storedCalibration(): LatencyCalibrationResult | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  return loadStoredLatencyCalibration(window.localStorage, navigator.userAgent);
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

function calibrationErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === "NotAllowedError" || reason.name === "SecurityError") {
      return "没有获得麦克风权限，无法校准；仍可直接开始或上传录音。";
    }
    if (reason.name === "NotFoundError" || reason.name === "DevicesNotFoundError") {
      return "没有检测到可用麦克风，无法进行设备校准。";
    }
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  return "设备校准没有成功，可以重试或直接开始演唱。";
}
