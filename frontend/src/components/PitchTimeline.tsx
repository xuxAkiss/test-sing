import { useMemo } from "react";

import type { ReferencePitchResponse } from "../types";

const WIDTH = 1000;
const HEIGHT = 560;
const LABEL_WIDTH = 72;
const TOP = 50;
const RIGHT = 24;
const BOTTOM = 24;
const WINDOW_SECONDS = 20;

interface PitchTimelineProps {
  pitch: ReferencePitchResponse;
  currentTime: number;
}

interface PitchSegment {
  start: number;
  end: number;
  midi: number;
}

export function PitchTimeline({ pitch, currentTime }: PitchTimelineProps) {
  const totalDuration = Math.max(pitch.duration_seconds, WINDOW_SECONDS);
  const windowStart = Math.min(
    Math.max(0, currentTime - 6),
    Math.max(0, totalDuration - WINDOW_SECONDS),
  );
  const windowEnd = Math.min(totalDuration, windowStart + WINDOW_SECONDS);
  const windowDuration = Math.max(1, windowEnd - windowStart);
  const [midiMinimum, midiMaximum] = pitchRange(pitch);
  const segments = useMemo(
    () => buildSegments(pitch, windowStart, windowEnd),
    [pitch, windowEnd, windowStart],
  );
  const plotWidth = WIDTH - LABEL_WIDTH - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const x = (seconds: number): number =>
    LABEL_WIDTH + ((seconds - windowStart) / windowDuration) * plotWidth;
  const y = (midi: number): number =>
    TOP + ((midiMaximum - midi) / (midiMaximum - midiMinimum)) * plotHeight;
  const playhead = x(Math.min(Math.max(currentTime, windowStart), windowEnd));
  const noteRows = noteRowValues(midiMinimum, midiMaximum);
  const timeTicks = Array.from({ length: 5 }, (_, index) => {
    const time = windowStart + (windowDuration * index) / 4;
    return { time, x: x(time) };
  });

  return (
    <div className="pitch-timeline">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="参考音调线">
        <title>参考音调线，播放指针随伴奏移动</title>
        <rect width={WIDTH} height={HEIGHT} className="timeline-background" />
        {timeTicks.map((tick) => (
          <g key={tick.time}>
            <line
              x1={round(tick.x)}
              y1={TOP}
              x2={round(tick.x)}
              y2={HEIGHT - BOTTOM}
              className="time-grid-line"
            />
            <text x={round(tick.x)} y={28} className="time-label">
              {formatTime(tick.time)}
            </text>
          </g>
        ))}
        {noteRows.map((midi) => (
          <g key={midi}>
            <line
              x1={LABEL_WIDTH}
              y1={round(y(midi))}
              x2={WIDTH - RIGHT}
              y2={round(y(midi))}
              className="note-grid-line"
            />
            <text x={LABEL_WIDTH - 16} y={round(y(midi) + 5)} className="note-label">
              {midiToNote(midi)}
            </text>
          </g>
        ))}
        {segments.flatMap((segment, index) => {
          const segmentY = round(y(segment.midi));
          const startX = round(x(segment.start));
          const endX = round(x(segment.end));
          if (segment.end <= currentTime) {
            return [
              <line
                key={`${index}-past`}
                x1={startX}
                y1={segmentY}
                x2={endX}
                y2={segmentY}
                className="pitch-segment pitch-segment-past"
              />,
            ];
          }
          if (segment.start >= currentTime) {
            return [
              <line
                key={`${index}-future`}
                x1={startX}
                y1={segmentY}
                x2={endX}
                y2={segmentY}
                className="pitch-segment pitch-segment-future"
              />,
            ];
          }
          return [
            <line
              key={`${index}-split-past`}
              x1={startX}
              y1={segmentY}
              x2={round(x(currentTime))}
              y2={segmentY}
              className="pitch-segment pitch-segment-past"
            />,
            <line
              key={`${index}-split-future`}
              x1={round(x(currentTime))}
              y1={segmentY}
              x2={endX}
              y2={segmentY}
              className="pitch-segment pitch-segment-future"
            />,
          ];
        })}
        <line
          x1={round(playhead)}
          y1={TOP - 8}
          x2={round(playhead)}
          y2={HEIGHT - BOTTOM}
          className="timeline-playhead"
        />
        <circle cx={round(playhead)} cy={TOP - 8} r={7} className="playhead-handle" />
      </svg>
    </div>
  );
}

function buildSegments(
  pitch: ReferencePitchResponse,
  windowStart: number,
  windowEnd: number,
): PitchSegment[] {
  const stride = Math.max(1, Math.round(0.08 / pitch.hop_seconds));
  const firstIndex = Math.max(
    0,
    Math.floor((windowStart - pitch.start_seconds) / pitch.hop_seconds),
  );
  const lastIndex = Math.min(
    pitch.frames.length - 1,
    Math.ceil((windowEnd - pitch.start_seconds) / pitch.hop_seconds),
  );
  const segments: PitchSegment[] = [];
  let active: PitchSegment | null = null;
  let lastTime = 0;

  const flush = (): void => {
    if (active && active.end - active.start >= 0.06) {
      segments.push(active);
    }
    active = null;
  };

  for (let index = firstIndex; index <= lastIndex; index += stride) {
    const value = pitch.frames[index];
    const time = pitch.start_seconds + index * pitch.hop_seconds;
    if (value === null) {
      flush();
      continue;
    }
    const quantized = Math.round(value * 2) / 2;
    const isContinuous =
      active !== null &&
      Math.abs(quantized - active.midi) <= 0.5 &&
      time - lastTime <= pitch.hop_seconds * stride * 1.8;
    if (isContinuous && active) {
      active.end = Math.min(windowEnd, time + pitch.hop_seconds * stride);
    } else {
      flush();
      active = {
        start: Math.max(windowStart, time),
        end: Math.min(windowEnd, time + pitch.hop_seconds * stride),
        midi: quantized,
      };
    }
    lastTime = time;
  }
  flush();
  return segments;
}

function pitchRange(pitch: ReferencePitchResponse): [number, number] {
  let minimum = pitch.minimum_midi ?? 48;
  let maximum = pitch.maximum_midi ?? 72;
  if (maximum - minimum < 12) {
    const middle = (minimum + maximum) / 2;
    minimum = middle - 6;
    maximum = middle + 6;
  }
  if (maximum - minimum > 24) {
    const middle = (minimum + maximum) / 2;
    minimum = middle - 12;
    maximum = middle + 12;
  }
  return [Math.floor(minimum) - 1, Math.ceil(maximum) + 1];
}

function noteRowValues(minimum: number, maximum: number): number[] {
  const values: number[] = [];
  const step = maximum - minimum > 16 ? 2 : 1;
  for (let midi = Math.ceil(maximum); midi >= Math.floor(minimum); midi -= step) {
    values.push(midi);
  }
  return values;
}

function midiToNote(midi: number): string {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const rounded = Math.round(midi);
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
