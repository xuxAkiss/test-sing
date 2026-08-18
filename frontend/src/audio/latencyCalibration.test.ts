import { beforeEach, describe, expect, it } from "vitest";

import {
  combineLatencyEstimates,
  compensatePlaybackTime,
  createCalibrationSignal,
  loadStoredLatencyCalibration,
  storeLatencyCalibration,
} from "./latencyCalibration";
import { estimateLatency } from "./latencyCalibration";

describe("latency calibration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("finds a calibration signal delayed in a microphone recording", () => {
    const sampleRate = 48_000;
    const expectedStartSample = Math.round(sampleRate * 0.2);
    const expectedDelayMs = 185;
    const delaySamples = Math.round((expectedDelayMs / 1_000) * sampleRate);
    const signal = createCalibrationSignal(sampleRate);
    const recording = new Float32Array(Math.round(sampleRate * 1.2));

    for (let index = 0; index < recording.length; index += 1) {
      recording[index] = Math.sin(index * 0.173) * 0.0015;
    }
    for (let index = 0; index < signal.length; index += 1) {
      recording[expectedStartSample + delaySamples + index] += signal[index] * 0.75;
    }

    const estimate = estimateLatency(
      signal,
      recording,
      sampleRate,
      expectedStartSample,
    );

    expect(estimate.delayMs).toBeCloseTo(expectedDelayMs, 0);
    expect(estimate.confidence).toBeGreaterThan(0.95);
  });

  it("combines stable measurements using their median", () => {
    const result = combineLatencyEstimates(
      [
        { delayMs: 182, confidence: 0.72 },
        { delayMs: 188, confidence: 0.68 },
        { delayMs: 185, confidence: 0.75 },
      ],
      123_456,
    );

    expect(result).toEqual({
      delayMs: 185,
      confidence: 0.72,
      spreadMs: 6,
      measuredAt: 123_456,
    });
  });

  it("rejects measurements that are too inconsistent", () => {
    expect(() =>
      combineLatencyEstimates([
        { delayMs: 100, confidence: 0.5 },
        { delayMs: 190, confidence: 0.6 },
        { delayMs: 310, confidence: 0.7 },
      ]),
    ).toThrow("三次测量差异较大");
  });

  it("stores a recent result for the same browser only", () => {
    const result = {
      delayMs: 184,
      confidence: 0.71,
      spreadMs: 12,
      measuredAt: 1_000_000,
    };
    storeLatencyCalibration(window.localStorage, "phone-browser", result);

    expect(
      loadStoredLatencyCalibration(
        window.localStorage,
        "phone-browser",
        1_000_500,
      ),
    ).toEqual(result);
    expect(
      loadStoredLatencyCalibration(window.localStorage, "another-browser", 1_000_500),
    ).toBeNull();
  });

  it("subtracts and clamps the measured delay on the live timeline", () => {
    expect(compensatePlaybackTime(12.5, 184, 10)).toBeCloseTo(12.316);
    expect(compensatePlaybackTime(10.1, 184, 10)).toBe(10);
    expect(compensatePlaybackTime(12.5, Number.NaN, 10)).toBe(12.5);
  });
});
