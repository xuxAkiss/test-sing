import type { ReferencePitchResponse } from "../types";

export function centeredPitchRange(
  pitch: ReferencePitchResponse,
  windowStart: number,
  windowEnd: number,
): [number, number] {
  const firstIndex = Math.max(
    0,
    Math.floor((windowStart - pitch.start_seconds) / pitch.hop_seconds),
  );
  const lastIndex = Math.min(
    pitch.frames.length - 1,
    Math.ceil((windowEnd - pitch.start_seconds) / pitch.hop_seconds),
  );
  let values = pitch.frames
    .slice(firstIndex, lastIndex + 1)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) {
    values = pitch.frames.filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
  }
  if (values.length === 0) {
    return [52, 68];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const lower = percentile(sorted, 0.03);
  const upper = percentile(sorted, 0.97);
  const center = (lower + upper) / 2;
  const halfSpan = Math.max(6, (upper - lower) / 2 + 2);
  return [Math.floor(center - halfSpan), Math.ceil(center + halfSpan)];
}

function percentile(sortedValues: number[], ratio: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * ratio)),
  );
  return sortedValues[index];
}
