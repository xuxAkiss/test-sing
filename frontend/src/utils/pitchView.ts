import type { ReferencePitchResponse } from "../types";

const OCTAVE_SEMITONES = 12;

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

export function referenceMidiNearTime(
  pitch: ReferencePitchResponse,
  timeSeconds: number,
  radiusSeconds = 0.3,
): number | null {
  const centerIndex = Math.round(
    (timeSeconds - pitch.start_seconds) / pitch.hop_seconds,
  );
  const radiusFrames = Math.max(
    1,
    Math.round(radiusSeconds / pitch.hop_seconds),
  );
  const startIndex = Math.max(0, centerIndex - radiusFrames);
  const endIndex = Math.min(pitch.frames.length - 1, centerIndex + radiusFrames);
  const values: number[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const value = pitch.frames[index];
    if (value !== null && Number.isFinite(value)) {
      values.push(value);
    }
  }
  if (values.length === 0) {
    return null;
  }
  return median(values);
}

export function foldMidiToReferenceOctave(
  midi: number,
  referenceMidi: number | null,
  previousMidi: number | null = null,
): number {
  const anchor = referenceMidi ?? previousMidi;
  if (!Number.isFinite(midi) || anchor === null || !Number.isFinite(anchor)) {
    return midi;
  }
  const octaveShift = Math.max(
    -2,
    Math.min(2, Math.round((anchor - midi) / OCTAVE_SEMITONES)),
  );
  return midi + octaveShift * OCTAVE_SEMITONES;
}

export function smoothedReferenceMidi(
  frames: Array<number | null>,
  index: number,
  radiusFrames: number,
): number | null {
  const current = frames[index];
  if (current === null || !Number.isFinite(current)) {
    return null;
  }
  const values: number[] = [];
  const start = Math.max(0, index - radiusFrames);
  const end = Math.min(frames.length - 1, index + radiusFrames);
  for (let cursor = start; cursor <= end; cursor += 1) {
    const value = frames[cursor];
    if (value !== null && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values.length >= 2 ? median(values) : current;
}

function percentile(sortedValues: number[], ratio: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * ratio)),
  );
  return sortedValues[index];
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
