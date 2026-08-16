import { useMemo, useState } from "react";

import { assetUrl } from "../api/client";
import {
  getLiveRecordingSupportIssue,
  useLivePerformance,
} from "../hooks/useLivePerformance";
import type {
  LivePitchPoint,
  ReferencePitchResponse,
  SingingMode,
  SingingSelection,
  SongResponse,
} from "../types";
import { displaySongTitle } from "../utils/songTitle";
import { suggestSegmentRange } from "../utils/singingRange";
import { MusicNoteIcon, PauseIcon } from "./Icons";
import { PitchTimeline } from "./PitchTimeline";
import { SingingModeSelector } from "./SingingModeSelector";
import { UploadView } from "./UploadView";

interface PerformanceEntryProps {
  song: SongResponse;
  pitch: ReferencePitchResponse;
  onRecording: (
    recording: File,
    selection: SingingSelection,
  ) => Promise<void> | void;
}

export function PerformanceEntry({
  song,
  pitch,
  onRecording,
}: PerformanceEntryProps) {
  const [uploadFallback, setUploadFallback] = useState(false);
  const [mode, setMode] = useState<SingingMode>("full");
  const songDuration = Math.max(
    0.01,
    song.duration_seconds ?? pitch.duration_seconds,
  );
  const [segmentSelection, setSegmentSelection] = useState<SingingSelection>(() =>
    suggestSegmentRange(pitch, songDuration),
  );
  const selection = useMemo<SingingSelection>(
    () =>
      mode === "full"
        ? { mode: "full", startSeconds: 0, endSeconds: songDuration }
        : { ...segmentSelection, mode: "segment" },
    [mode, segmentSelection, songDuration],
  );
  const accompaniment = song.resources?.accompaniment;
  const {
    audioRef,
    status,
    error,
    currentTime,
    duration,
    pitchPoints,
    start,
    stop,
    updateDuration,
  } = useLivePerformance({
    fallbackDuration: songDuration,
    rangeStartSeconds: selection.startSeconds,
    rangeEndSeconds: selection.endSeconds,
    onComplete: (recording) => onRecording(recording, selection),
  });

  if (uploadFallback) {
    return (
      <UploadView
        mode="performance"
        onFile={(recording) => onRecording(recording, selection)}
        onBack={() => setUploadFallback(false)}
        backLabel="返回实时演唱"
      />
    );
  }

  if (!accompaniment) {
    return null;
  }

  const isLive = status === "recording" || status === "stopping";
  return (
    <>
      <audio
        ref={audioRef}
        className="visually-hidden"
        src={assetUrl(accompaniment)}
        preload="auto"
        onLoadedMetadata={(event) => updateDuration(event.currentTarget.duration)}
        onEnded={() => void stop()}
      />
      {isLive ? (
        <LiveSingingScreen
          song={song}
          pitch={pitch}
          status={status}
          currentTime={currentTime}
          duration={duration}
          pitchPoints={pitchPoints}
          selection={selection}
          onStop={stop}
        />
      ) : (
        <MicrophonePreflight
          song={song}
          pitch={pitch}
          mode={mode}
          selection={selection}
          songDuration={songDuration}
          requesting={status === "requesting"}
          error={error ?? getLiveRecordingSupportIssue()}
          onStart={() => void start()}
          onUpload={() => setUploadFallback(true)}
          onModeChange={setMode}
          onRangeChange={(startSeconds, endSeconds) =>
            setSegmentSelection({ mode: "segment", startSeconds, endSeconds })
          }
        />
      )}
    </>
  );
}

interface MicrophonePreflightProps {
  song: SongResponse;
  pitch: ReferencePitchResponse;
  mode: SingingMode;
  selection: SingingSelection;
  songDuration: number;
  requesting: boolean;
  error: string | null;
  onStart: () => void;
  onUpload: () => void;
  onModeChange: (mode: SingingMode) => void;
  onRangeChange: (startSeconds: number, endSeconds: number) => void;
}

function MicrophonePreflight({
  song,
  pitch,
  mode,
  selection,
  songDuration,
  requesting,
  error,
  onStart,
  onUpload,
  onModeChange,
  onRangeChange,
}: MicrophonePreflightProps) {
  const unsupported = getLiveRecordingSupportIssue() !== null;
  return (
    <main className="microphone-preflight performance-setup">
      <header className="performance-setup-heading">
        <h1>{displaySongTitle(song.title)}</h1>
      </header>
      <SingingModeSelector
        mode={mode}
        pitch={pitch}
        selection={selection}
        songDuration={songDuration}
        onModeChange={onModeChange}
        onRangeChange={onRangeChange}
      />
      {error ? (
        <p className="microphone-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="microphone-actions">
        <button
          className="primary-button"
          type="button"
          disabled={requesting || unsupported}
          onClick={onStart}
        >
          {requesting ? "正在连接麦克风…" : "允许麦克风并开始"}
        </button>
        <button className="secondary-button" type="button" onClick={onUpload}>
          上传已有录音
        </button>
      </div>
      <p className="microphone-explanation">
        麦克风会实时识别你的音高，并录制本次演唱用于评分
      </p>
      <p className="microphone-advice">
        建议佩戴耳机，或将手机远离外放音箱
      </p>
    </main>
  );
}

interface LiveSingingScreenProps {
  song: SongResponse;
  pitch: ReferencePitchResponse;
  status: "recording" | "stopping";
  currentTime: number;
  duration: number;
  pitchPoints: LivePitchPoint[];
  selection: SingingSelection;
  onStop: () => Promise<void>;
}

function LiveSingingScreen({
  song,
  pitch,
  status,
  currentTime,
  duration,
  pitchPoints,
  selection,
  onStop,
}: LiveSingingScreenProps) {
  const effectiveEnd = Math.min(selection.endSeconds, duration);
  const sessionDuration = Math.max(0.01, effectiveEnd - selection.startSeconds);
  const elapsed = Math.max(0, currentTime - selection.startSeconds);
  const progress = Math.min(100, (elapsed / sessionDuration) * 100);
  return (
    <main className="live-singing-screen">
      <header className="live-song-heading">
        <h1>{displaySongTitle(song.title)}</h1>
        <p>
          <span className="recording-dot" aria-hidden="true" />
          {selection.mode === "segment" ? "片段演唱" : "完整演唱"}
          <time>
            {formatTime(currentTime)} / {formatTime(effectiveEnd)}
          </time>
        </p>
      </header>
      <PitchTimeline
        pitch={pitch}
        currentTime={currentTime}
        userPitch={pitchPoints}
        rangeStart={selection.startSeconds}
        rangeEnd={effectiveEnd}
        live
      />
      <div className="live-accompaniment">
        <span className="live-pause-icon" aria-hidden="true">
          <PauseIcon />
        </span>
        <time>{formatTime(elapsed)}</time>
        <div className="live-progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <time>{formatTime(sessionDuration)}</time>
      </div>
      <button
        className="primary-button live-stop-button"
        type="button"
        disabled={status === "stopping"}
        onClick={() => void onStop()}
      >
        {status === "stopping" ? "正在准备评分…" : "结束并评分"}
      </button>
      <p className="live-playing-note">
        <MusicNoteIcon />
        伴奏播放中
      </p>
    </main>
  );
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
