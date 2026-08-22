import { useId, useMemo } from "react";

import type { LivePitchPoint, ReferencePitchResponse } from "../types";
import {
  centeredPitchRange,
  smoothedReferenceMidi,
} from "../utils/pitchView";

const WIDTH = 1000;
const DEFAULT_HEIGHT = 560;
const LIVE_HEIGHT = 900;
const LABEL_WIDTH = 72;
const TOP = 50;
const RIGHT = 24;
const BOTTOM = 24;
const WINDOW_SECONDS = 20;

interface PitchTimelineProps {
  pitch: ReferencePitchResponse;
  currentTime: number;
  userPitch?: LivePitchPoint[];
  rangeStart?: number;
  rangeEnd?: number;
  live?: boolean;
}

export function PitchTimeline({
  pitch,
  currentTime,
  userPitch = [],
  rangeStart = 0,
  rangeEnd = pitch.duration_seconds,
  live = false,
}: PitchTimelineProps) {
  const pastClipId = `reference-past-${useId().replaceAll(":", "")}`;
  const height = live ? LIVE_HEIGHT : DEFAULT_HEIGHT;
  const sessionStart = Math.max(0, rangeStart);
  const sessionEnd = Math.max(sessionStart + 0.01, rangeEnd);
  const visibleSeconds = Math.min(WINDOW_SECONDS, sessionEnd - sessionStart);
  const windowStart = Math.min(
    Math.max(sessionStart, currentTime - (live ? 10 : 6)),
    Math.max(sessionStart, sessionEnd - visibleSeconds),
  );
  const windowEnd = Math.min(sessionEnd, windowStart + visibleSeconds);
  const windowDuration = Math.max(1, windowEnd - windowStart);
  const [midiMinimum, midiMaximum] = centeredPitchRange(
    pitch,
    windowStart,
    windowEnd,
  );
  const plotWidth = WIDTH - LABEL_WIDTH - RIGHT;
  const plotHeight = height - TOP - BOTTOM;
  const x = (seconds: number): number =>
    LABEL_WIDTH + ((seconds - windowStart) / windowDuration) * plotWidth;
  const y = (midi: number): number =>
    TOP + ((midiMaximum - midi) / (midiMaximum - midiMinimum)) * plotHeight;
  const playhead = x(Math.min(Math.max(currentTime, windowStart), windowEnd));
  const referencePath = useMemo(
    () =>
      buildReferencePitchPath(
        pitch,
        windowStart,
        windowEnd,
        midiMinimum,
        midiMaximum,
        plotWidth,
        plotHeight,
        windowDuration,
      ),
    [
      midiMaximum,
      midiMinimum,
      pitch,
      plotHeight,
      plotWidth,
      windowDuration,
      windowEnd,
      windowStart,
    ],
  );
  const userPaths = useMemo(
    () =>
      buildUserPitchPaths(
        userPitch,
        windowStart,
        windowEnd,
        midiMinimum,
        midiMaximum,
        plotWidth,
        plotHeight,
        windowDuration,
      ),
    [
      midiMaximum,
      midiMinimum,
      plotHeight,
      plotWidth,
      userPitch,
      windowDuration,
      windowEnd,
      windowStart,
    ],
  );
  const noteRows = noteRowValues(midiMinimum, midiMaximum);
  const timeTicks = Array.from({ length: 5 }, (_, index) => {
    const time = windowStart + (windowDuration * index) / 4;
    return { time, x: x(time) };
  });

  return (
    <div className={`pitch-timeline${live ? " is-live" : ""}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={live ? "实时演唱音调线" : "原唱人声音调线"}
      >
        <title>
          {live
            ? "青色为原唱人声音调，珊瑚色为你的实时音高"
            : "从分离后的原唱人声提取的音调线，播放指针随伴奏移动"}
        </title>
        <defs>
          <clipPath id={pastClipId}>
            <rect
              x={LABEL_WIDTH}
              y={TOP - 10}
              width={Math.max(0, playhead - LABEL_WIDTH)}
              height={plotHeight + 20}
            />
          </clipPath>
        </defs>
        <rect width={WIDTH} height={height} className="timeline-background" />
        {timeTicks.map((tick) => (
          <g key={tick.time}>
            <line
              x1={round(tick.x)}
              y1={TOP}
              x2={round(tick.x)}
              y2={height - BOTTOM}
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
        {referencePath ? (
          <path
            d={referencePath}
            className={`reference-pitch-path ${
              live ? "reference-pitch-live" : "reference-pitch-future"
            }`}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {!live && referencePath ? (
          <path
            d={referencePath}
            className="reference-pitch-path reference-pitch-past"
            clipPath={`url(#${pastClipId})`}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {userPaths.map((path, index) => (
          <path
            key={`${path}-${index}`}
            d={path}
            className="user-pitch-path"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={round(playhead)}
          y1={TOP - 8}
          x2={round(playhead)}
          y2={height - BOTTOM}
          className="timeline-playhead"
        />
        <circle cx={round(playhead)} cy={TOP - 8} r={7} className="playhead-handle" />
      </svg>
      {live ? (
        <div className="live-pitch-legend" aria-hidden="true">
          <span><i className="reference-key" />原唱音调</span>
          <span><i className="user-key" />你的音高（八度等价）</span>
        </div>
      ) : null}
    </div>
  );
}

function buildUserPitchPaths(
  points: LivePitchPoint[],
  windowStart: number,
  windowEnd: number,
  midiMinimum: number,
  midiMaximum: number,
  plotWidth: number,
  plotHeight: number,
  windowDuration: number,
): string[] {
  const paths: string[] = [];
  let current: string[] = [];
  let lastTime: number | null = null;
  const flush = (): void => {
    if (current.length >= 2) {
      paths.push(current.join(" "));
    }
    current = [];
    lastTime = null;
  };

  for (const point of points) {
    if (
      point.midi === null ||
      !Number.isFinite(point.midi) ||
      point.time < windowStart ||
      point.time > windowEnd ||
      point.midi < midiMinimum - 1 ||
      point.midi > midiMaximum + 1 ||
      (lastTime !== null && point.time - lastTime > 0.24)
    ) {
      flush();
      continue;
    }
    const pointX = LABEL_WIDTH + ((point.time - windowStart) / windowDuration) * plotWidth;
    const pointY =
      TOP + ((midiMaximum - point.midi) / (midiMaximum - midiMinimum)) * plotHeight;
    current.push(`${current.length === 0 ? "M" : "L"}${round(pointX)},${round(pointY)}`);
    lastTime = point.time;
  }
  flush();
  return paths;
}

function buildReferencePitchPath(
  pitch: ReferencePitchResponse,
  windowStart: number,
  windowEnd: number,
  midiMinimum: number,
  midiMaximum: number,
  plotWidth: number,
  plotHeight: number,
  windowDuration: number,
): string {
  const stride = Math.max(1, Math.round(0.06 / pitch.hop_seconds));
  const smoothingRadius = Math.max(1, Math.round(0.04 / pitch.hop_seconds));
  const firstIndex = Math.max(
    0,
    Math.floor((windowStart - pitch.start_seconds) / pitch.hop_seconds),
  );
  const lastIndex = Math.min(
    pitch.frames.length - 1,
    Math.ceil((windowEnd - pitch.start_seconds) / pitch.hop_seconds),
  );
  const commands: string[] = [];
  let lastTime: number | null = null;
  let lastMidi: number | null = null;

  for (let index = firstIndex; index <= lastIndex; index += stride) {
    const value = smoothedReferenceMidi(
      pitch.frames,
      index,
      smoothingRadius,
    );
    const time = pitch.start_seconds + index * pitch.hop_seconds;
    if (time < windowStart || time > windowEnd || value === null) {
      lastTime = null;
      lastMidi = null;
      continue;
    }
    const isContinuous =
      lastTime !== null &&
      lastMidi !== null &&
      time - lastTime <= pitch.hop_seconds * stride * 2.2 &&
      Math.abs(value - lastMidi) <= 3.5;
    const pointX =
      LABEL_WIDTH + ((time - windowStart) / windowDuration) * plotWidth;
    const pointY =
      TOP + ((midiMaximum - value) / (midiMaximum - midiMinimum)) * plotHeight;
    commands.push(`${isContinuous ? "L" : "M"}${round(pointX)},${round(pointY)}`);
    lastTime = time;
    lastMidi = value;
  }
  return commands.join(" ");
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
