import { describe, expect, it } from "vitest";

import type { ReferencePitchResponse } from "../types";
import { centeredPitchRange } from "../utils/pitchView";

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
