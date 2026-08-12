import { describe, expect, it } from "vitest";

import { displaySongTitle } from "./songTitle";

describe("displaySongTitle", () => {
  it("removes provider artist and numeric suffixes", () => {
    expect(displaySongTitle("七里香-周杰伦-94237-100")).toBe("七里香");
  });

  it("preserves ordinary titles that contain punctuation", () => {
    expect(displaySongTitle("Love-Story")).toBe("Love-Story");
  });
});
