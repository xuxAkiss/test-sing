import { describe, expect, it } from "vitest";

import {
  performancePlaybackStart,
  singingCountdownSeconds,
} from "./singingRange";

describe("segment pre-roll", () => {
  it("starts segment accompaniment five seconds before the selected range", () => {
    expect(
      performancePlaybackStart({
        mode: "segment",
        startSeconds: 20,
        endSeconds: 50,
      }),
    ).toBe(15);
  });

  it("clamps the lead-in at the beginning of the song", () => {
    expect(
      performancePlaybackStart({
        mode: "segment",
        startSeconds: 3,
        endSeconds: 33,
      }),
    ).toBe(0);
  });

  it("does not add a countdown to full-song singing", () => {
    expect(
      performancePlaybackStart({
        mode: "full",
        startSeconds: 0,
        endSeconds: 60,
      }),
    ).toBe(0);
  });

  it("reports whole countdown seconds until the selected start", () => {
    expect(singingCountdownSeconds(15, 20)).toBe(5);
    expect(singingCountdownSeconds(19.2, 20)).toBe(1);
    expect(singingCountdownSeconds(20, 20)).toBe(0);
  });
});
