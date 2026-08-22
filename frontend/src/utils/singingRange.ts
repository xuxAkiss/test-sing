import type { ReferencePitchResponse, SingingSelection } from "../types";

const DEFAULT_SEGMENT_SECONDS = 30;
export const SEGMENT_PRE_ROLL_SECONDS = 5;

export function suggestSegmentRange(
  pitch: ReferencePitchResponse,
  durationSeconds: number,
): SingingSelection {
  const duration = Math.max(0.01, durationSeconds);
  const segmentLength = Math.min(DEFAULT_SEGMENT_SECONDS, duration);
  if (duration <= segmentLength) {
    return { mode: "segment", startSeconds: 0, endSeconds: duration };
  }

  const windowFrames = Math.max(1, Math.round(segmentLength / pitch.hop_seconds));
  const prefix = new Uint32Array(pitch.frames.length + 1);
  for (let index = 0; index < pitch.frames.length; index += 1) {
    prefix[index + 1] = prefix[index] + (pitch.frames[index] === null ? 0 : 1);
  }
  let bestIndex = 0;
  let bestVoicedFrames = -1;
  const frameStep = Math.max(1, Math.round(1 / pitch.hop_seconds));
  for (let index = 0; index < pitch.frames.length; index += frameStep) {
    const endIndex = Math.min(pitch.frames.length, index + windowFrames);
    const voicedFrames = prefix[endIndex] - prefix[index];
    if (voicedFrames > bestVoicedFrames) {
      bestVoicedFrames = voicedFrames;
      bestIndex = index;
    }
  }
  const rawStart = pitch.start_seconds + bestIndex * pitch.hop_seconds;
  const startSeconds = Math.max(0, Math.min(Math.floor(rawStart), duration - segmentLength));
  return {
    mode: "segment",
    startSeconds,
    endSeconds: startSeconds + segmentLength,
  };
}

export function performancePlaybackStart(
  selection: SingingSelection,
  preRollSeconds = SEGMENT_PRE_ROLL_SECONDS,
): number {
  return selection.mode === "segment"
    ? Math.max(0, selection.startSeconds - Math.max(0, preRollSeconds))
    : selection.startSeconds;
}

export function singingCountdownSeconds(
  currentTime: number,
  selectionStart: number,
): number {
  return Math.max(0, Math.ceil(selectionStart - currentTime));
}

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
