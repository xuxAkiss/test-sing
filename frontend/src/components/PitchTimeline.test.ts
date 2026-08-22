import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ReferencePitchResponse } from "../types";
import {
  centeredPitchRange,
  foldMidiToReferenceOctave,
  referenceMidiNearTime,
  smoothedReferenceMidi,
} from "../utils/pitchView";
import { PitchTimeline } from "./PitchTimeline";

describe("centeredPitchRange", () => {
  it("centers the visible scale on the local original-vocal melody", () => {
    const pitch: ReferencePitchResponse = {
      schema_version: 2,
      source: "separated_original_vocals",
      start_seconds: 0,
      hop_seconds: 1,
      duration_seconds: 30,
      voiced_frames: 20,
      minimum_midi: 40,
      maximum_midi: 90,
      frames: [
        40, 90, null, null, null,
        59, 60, 60, 61, 60,
        59, 60, 61, 60, 59,
        null, null, null, 88, 42,
      ],
    };

    const [minimum, maximum] = centeredPitchRange(pitch, 5, 15);

    expect((minimum + maximum) / 2).toBeCloseTo(60, 0);
    expect(maximum - minimum).toBeGreaterThanOrEqual(12);
    expect(maximum).toBeLessThan(80);
  });
});

describe("reference and live pitch normalization", () => {
  const pitch: ReferencePitchResponse = {
    schema_version: 2,
    source: "separated_original_vocals",
    start_seconds: 0,
    hop_seconds: 0.1,
    duration_seconds: 2,
    voiced_frames: 16,
    minimum_midi: 56,
    maximum_midi: 61,
    frames: [
      null, 57, 57.2, 57.1, 57.3, null, null, 59, 59.1, 71, 59.2,
      null, 60, 60.1, 60.2, 60.1, null, null, null, null,
    ],
  };

  it("finds the local original-vocal octave and folds a subharmonic into it", () => {
    expect(referenceMidiNearTime(pitch, 0.3)).toBeCloseTo(57.15, 1);
    expect(foldMidiToReferenceOctave(45.1, 57.1)).toBeCloseTo(57.1, 4);
    expect(foldMidiToReferenceOctave(69.1, 57.1)).toBeCloseTo(57.1, 4);
    expect(foldMidiToReferenceOctave(56.8, 57.1)).toBeCloseTo(56.8, 4);
  });

  it("suppresses an isolated octave spike without bridging silence", () => {
    expect(smoothedReferenceMidi(pitch.frames, 9, 2)).toBeCloseTo(59.15, 2);
    expect(smoothedReferenceMidi(pitch.frames, 11, 2)).toBeNull();
  });

  it("renders the original vocal as one continuous SVG path geometry", () => {
    const { container } = render(
      createElement(PitchTimeline, {
        pitch,
        currentTime: 0.8,
        rangeEnd: 2,
      }),
    );
    const paths = [...container.querySelectorAll("path.reference-pitch-path")];

    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute("d")).toBe(paths[1].getAttribute("d"));
    expect(container.querySelectorAll(".pitch-segment")).toHaveLength(0);
  });
});
