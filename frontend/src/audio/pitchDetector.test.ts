import { describe, expect, it } from "vitest";

import { detectPitch, frequencyToMidi } from "./pitchDetector";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 4_096;

describe("detectPitch", () => {
  it.each([110, 220, 440, 659.255])("detects a stable %d Hz tone", (frequency) => {
    const samples = sineWave(frequency, 0.35);
    const detected = detectPitch(samples, SAMPLE_RATE);

    expect(detected).not.toBeNull();
    expect(Math.abs(1_200 * Math.log2((detected as number) / frequency))).toBeLessThan(8);
  });

  it("treats silence and very quiet input as unvoiced", () => {
    expect(detectPitch(new Float32Array(FRAME_SIZE), SAMPLE_RATE)).toBeNull();
    expect(detectPitch(sineWave(220, 0.002), SAMPLE_RATE)).toBeNull();
  });

  it("converts concert A to MIDI 69", () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69, 6);
  });
});

function sineWave(frequency: number, amplitude: number): Float32Array {
  return Float32Array.from({ length: FRAME_SIZE }, (_, index) =>
    amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE),
  );
}
