import { useMemo } from "react";

import type {
  ReferencePitchResponse,
  SingingMode,
  SingingSelection,
} from "../types";
import { formatTime } from "../utils/singingRange";

const MIN_SEGMENT_SECONDS = 10;

interface SingingModeSelectorProps {
  mode: SingingMode;
  pitch: ReferencePitchResponse;
  selection: SingingSelection;
  songDuration: number;
  onModeChange: (mode: SingingMode) => void;
  onRangeChange: (startSeconds: number, endSeconds: number) => void;
}

export function SingingModeSelector({
  mode,
  pitch,
  selection,
  songDuration,
  onModeChange,
  onRangeChange,
}: SingingModeSelectorProps) {
  const minimumLength = Math.min(MIN_SEGMENT_SECONDS, songDuration);
  const startPercent = (selection.startSeconds / songDuration) * 100;
  const endPercent = (selection.endSeconds / songDuration) * 100;

  const updateStart = (value: number): void => {
    onRangeChange(
      Math.min(value, selection.endSeconds - minimumLength),
      selection.endSeconds,
    );
  };
  const updateEnd = (value: number): void => {
    onRangeChange(
      selection.startSeconds,
      Math.max(value, selection.startSeconds + minimumLength),
    );
  };

  return (
    <section className="singing-mode-section" aria-labelledby="singing-mode-title">
      <h2 id="singing-mode-title">选择演唱方式</h2>
      <div className="singing-mode-options" role="radiogroup" aria-label="演唱方式">
        <label className={`singing-mode-option${mode === "full" ? " is-selected" : ""}`}>
          <input
            type="radio"
            name="singing-mode"
            value="full"
            checked={mode === "full"}
            onChange={() => onModeChange("full")}
          />
          <span className="mode-radio" aria-hidden="true" />
          <span>
            <strong>完整演唱</strong>
            <small>从头到尾演唱并完成整首评分</small>
          </span>
        </label>
        <label className={`singing-mode-option${mode === "segment" ? " is-selected" : ""}`}>
          <input
            type="radio"
            name="singing-mode"
            value="segment"
            checked={mode === "segment"}
            onChange={() => onModeChange("segment")}
          />
          <span className="mode-radio" aria-hidden="true" />
          <span>
            <strong>选取段落</strong>
            <small>选择一段重点练习并单独评分</small>
          </span>
        </label>
      </div>
      {mode === "segment" ? (
        <div className="segment-range-editor">
          <div className="segment-range-heading">
            <span>演唱范围</span>
            <strong>
              {formatTime(selection.startSeconds)} — {formatTime(selection.endSeconds)}
            </strong>
            <em>{Math.round(selection.endSeconds - selection.startSeconds)} 秒</em>
          </div>
          <div
            className="dual-range"
            style={{
              "--range-start": `${startPercent}%`,
              "--range-end": `${endPercent}%`,
            } as React.CSSProperties}
          >
            <span className="dual-range-base" aria-hidden="true" />
            <span className="dual-range-selection" aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={songDuration}
              step={0.5}
              value={selection.startSeconds}
              onChange={(event) => updateStart(Number(event.target.value))}
              aria-label="片段开始时间"
              aria-valuetext={formatTime(selection.startSeconds)}
            />
            <input
              type="range"
              min={0}
              max={songDuration}
              step={0.5}
              value={selection.endSeconds}
              onChange={(event) => updateEnd(Number(event.target.value))}
              aria-label="片段结束时间"
              aria-valuetext={formatTime(selection.endSeconds)}
            />
          </div>
          <div className="segment-range-limits" aria-hidden="true">
            <time>00:00</time>
            <time>{formatTime(songDuration)}</time>
          </div>
          <PitchRangeOverview
            pitch={pitch}
            startSeconds={selection.startSeconds}
            endSeconds={selection.endSeconds}
            songDuration={songDuration}
          />
        </div>
      ) : null}
    </section>
  );
}

interface PitchRangeOverviewProps {
  pitch: ReferencePitchResponse;
  startSeconds: number;
  endSeconds: number;
  songDuration: number;
}

function PitchRangeOverview({
  pitch,
  startSeconds,
  endSeconds,
  songDuration,
}: PitchRangeOverviewProps) {
  const notes = useMemo(() => {
    const voiced = pitch.frames.filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
    const center = median(voiced) ?? 60;
    const minimum = center - 12;
    const maximum = center + 12;
    const stride = Math.max(1, Math.ceil(pitch.frames.length / 240));
    const result: Array<{ x: number; y: number; width: number }> = [];
    for (let index = 0; index < pitch.frames.length; index += stride) {
      const value = pitch.frames[index];
      if (value === null || !Number.isFinite(value)) {
        continue;
      }
      const time = pitch.start_seconds + index * pitch.hop_seconds;
      result.push({
        x: (time / songDuration) * 1000,
        y: 84 - ((value - minimum) / (maximum - minimum)) * 68,
        width: Math.max(2, (pitch.hop_seconds * stride * 1000) / songDuration),
      });
    }
    return result;
  }, [pitch, songDuration]);
  const selectionX = (startSeconds / songDuration) * 1000;
  const selectionWidth = ((endSeconds - startSeconds) / songDuration) * 1000;

  return (
    <svg
      className="pitch-range-overview"
      viewBox="0 0 1000 100"
      role="img"
      aria-label="原唱人声音高概览"
      preserveAspectRatio="none"
    >
      <rect
        x={selectionX}
        y={0}
        width={selectionWidth}
        height={100}
        className="range-overview-selection"
      />
      {notes.map((note, index) => (
        <line
          key={index}
          x1={note.x}
          y1={note.y}
          x2={Math.min(1000, note.x + note.width)}
          y2={note.y}
          className="range-overview-note"
        />
      ))}
      <line x1={selectionX} y1={0} x2={selectionX} y2={100} className="range-boundary" />
      <line
        x1={selectionX + selectionWidth}
        y1={0}
        x2={selectionX + selectionWidth}
        y2={100}
        className="range-boundary"
      />
    </svg>
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
