import { describe, expect, it } from "vitest";

import type { ScoreResponse } from "../types";
import { buildScoreFeedback } from "./scoreFeedback";

const baseScore: ScoreResponse = {
  overall: 79.4,
  pitch: 68.7,
  rhythm: 93,
  completeness: 92.5,
  stability: 91.6,
  alignment: { octave_shift_semitones: -12 },
  diagnostics: {
    median_signed_error_cents: 0.56,
    p90_absolute_error_cents: 316.17,
  },
};

describe("buildScoreFeedback", () => {
  it("turns the strongest and weakest metrics into actionable feedback", () => {
    const feedback = buildScoreFeedback(baseScore);

    expect(feedback.summary).toBe("节奏稳定，旋律基本完整");
    expect(feedback.strength).toContain("节奏与完整度");
    expect(feedback.focus).toContain("部分音符与参考音高偏差较大");
    expect(feedback.registerNote).toBe("已按低一个八度等价评分");
  });

  it("uses the signed pitch error when the whole performance trends high", () => {
    const feedback = buildScoreFeedback({
      ...baseScore,
      diagnostics: {
        median_signed_error_cents: 48,
        p90_absolute_error_cents: 220,
      },
    });

    expect(feedback.focus).toContain("整体音高略偏高");
  });

  it("can recommend completeness without inventing pitch advice", () => {
    const feedback = buildScoreFeedback({
      ...baseScore,
      pitch: 88,
      completeness: 54,
      alignment: null,
    });

    expect(feedback.focus).toContain("把每句唱完整");
    expect(feedback.registerNote).toBeNull();
  });
});
