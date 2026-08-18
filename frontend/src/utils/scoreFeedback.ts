import type { ScoreResponse } from "../types";

type MetricKey = "pitch" | "rhythm" | "completeness" | "stability";

interface MetricDefinition {
  key: MetricKey;
  label: string;
}

export interface ScoreFeedback {
  summary: string;
  strength: string;
  focus: string;
  registerNote: string | null;
}

const metrics: MetricDefinition[] = [
  { key: "pitch", label: "音准" },
  { key: "rhythm", label: "节奏" },
  { key: "completeness", label: "完整度" },
  { key: "stability", label: "稳定性" },
];

export function buildScoreFeedback(score: ScoreResponse): ScoreFeedback {
  const ranked = [...metrics].sort((left, right) => score[right.key] - score[left.key]);
  const strongest = ranked.slice(0, 2).map((metric) => metric.key);
  const weakest = ranked.at(-1)?.key ?? "pitch";

  return {
    summary: summaryFor(score),
    strength: strengthFor(strongest),
    focus: focusFor(weakest, score),
    registerNote: registerNoteFor(score),
  };
}

function summaryFor(score: ScoreResponse): string {
  if (score.overall >= 90) {
    return "整体稳定，细节已经很接近参考旋律";
  }
  if (score.overall >= 80) {
    return score.pitch === Math.min(score.pitch, score.rhythm, score.completeness, score.stability)
      ? "节奏稳定，音准还有提升空间"
      : "演唱完成度很高，再打磨薄弱项";
  }
  if (score.overall >= 70) {
    return "节奏稳定，旋律基本完整";
  }
  if (score.overall >= 60) {
    return "已经完成整首演唱，分段练习会进步更快";
  }
  return "先跟稳参考线，再逐步提升完整度";
}

function strengthFor(strongest: MetricKey[]): string {
  const pair = new Set(strongest);
  if (pair.has("rhythm") && pair.has("completeness")) {
    return "节奏与完整度都很稳定，整首演唱跟得很完整。";
  }
  if (pair.has("pitch") && pair.has("stability")) {
    return "音高走向与发声稳定性表现最好，旋律控制比较连贯。";
  }
  if (pair.has("pitch") && pair.has("rhythm")) {
    return "音准和节奏是本次优势，旋律与伴奏配合较稳。";
  }
  if (pair.has("rhythm") && pair.has("stability")) {
    return "节奏与稳定性表现最好，演唱推进比较从容。";
  }
  if (pair.has("completeness") && pair.has("stability")) {
    return "演唱完整且状态稳定，大部分应唱段落都有覆盖。";
  }
  return "旋律音高和演唱完整度表现最好，歌曲主体已经唱完整。";
}

function focusFor(weakest: MetricKey, score: ScoreResponse): string {
  if (weakest === "pitch") {
    const medianError = recordNumber(score.diagnostics, "median_signed_error_cents");
    const p90Error = recordNumber(score.diagnostics, "p90_absolute_error_cents");
    if (medianError !== null && Math.abs(medianError) >= 35) {
      const direction = medianError > 0 ? "偏高" : "偏低";
      return `整体音高略${direction}，先用短句跟随参考线，再练长音落点。`;
    }
    if (p90Error !== null && p90Error >= 250) {
      return "部分音符与参考音高偏差较大，先分段练习长音的起点和收尾。";
    }
    return "先集中练习音准，留意偏高或偏低的长音。";
  }
  if (weakest === "rhythm") {
    return "先听清每句开头再进入，减少抢拍或拖拍。";
  }
  if (weakest === "completeness") {
    return "有些应唱段落没有稳定覆盖，先用短片段把每句唱完整。";
  }
  return "长音中的音高波动较明显，尝试用更均匀的气息保持收尾。";
}

function registerNoteFor(score: ScoreResponse): string | null {
  const semitones = recordNumber(score.alignment, "octave_shift_semitones");
  if (semitones === null || Math.abs(semitones) < 6) {
    return null;
  }
  const octaves = Math.round(Math.abs(semitones) / 12);
  if (octaves < 1) {
    return null;
  }
  const direction = semitones > 0 ? "高" : "低";
  const count = octaves === 1 ? "一个" : `${octaves}个`;
  return `已按${direction}${count}八度等价评分`;
}

function recordNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
