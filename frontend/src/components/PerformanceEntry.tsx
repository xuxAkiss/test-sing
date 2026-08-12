import { useState } from "react";

import { assetUrl } from "../api/client";
import {
  getLiveRecordingSupportIssue,
  useLivePerformance,
} from "../hooks/useLivePerformance";
import type {
  LivePitchPoint,
  ReferencePitchResponse,
  SongResponse,
} from "../types";
import { displaySongTitle } from "../utils/songTitle";
import { MicrophoneIcon, MusicNoteIcon, PauseIcon } from "./Icons";
import { PitchTimeline } from "./PitchTimeline";
import { UploadView } from "./UploadView";

interface PerformanceEntryProps {
  song: SongResponse;
  pitch: ReferencePitchResponse;
  onRecording: (recording: File) => Promise<void> | void;
}

const WAVEFORM_HEIGHTS = [
  4, 7, 12, 21, 35, 20, 13, 25, 31, 18, 10, 27, 37, 28, 15, 7, 18, 32,
  22, 12, 6, 14, 28, 38, 24, 17, 9, 5,
];

export function PerformanceEntry({
  song,
  pitch,
  onRecording,
}: PerformanceEntryProps) {
  const [uploadFallback, setUploadFallback] = useState(false);
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
    fallbackDuration: song.duration_seconds ?? pitch.duration_seconds,
    onComplete: onRecording,
  });

  if (uploadFallback) {
    return (
      <UploadView
        mode="performance"
        onFile={onRecording}
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
          onStop={stop}
        />
      ) : (
        <MicrophonePreflight
          requesting={status === "requesting"}
          error={error ?? getLiveRecordingSupportIssue()}
          onStart={() => void start()}
          onUpload={() => setUploadFallback(true)}
        />
      )}
    </>
  );
}

interface MicrophonePreflightProps {
  requesting: boolean;
  error: string | null;
  onStart: () => void;
  onUpload: () => void;
}

function MicrophonePreflight({
  requesting,
  error,
  onStart,
  onUpload,
}: MicrophonePreflightProps) {
  const unsupported = getLiveRecordingSupportIssue() !== null;
  return (
    <main className="microphone-preflight">
      <h1>准备开始演唱</h1>
      <div className="microphone-visual" aria-hidden="true">
        <div className="microphone-rings" />
        <div className="microphone-waveform">
          {WAVEFORM_HEIGHTS.map((height, index) => (
            <span
              key={`${height}-${index}`}
              className={index === 14 || index === 21 ? "is-cyan" : undefined}
              style={{ height }}
            />
          ))}
        </div>
        <MicrophoneIcon />
      </div>
      <p className="microphone-explanation">
        需要使用麦克风实时识别音高并录制本次演唱
      </p>
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
  onStop: () => Promise<void>;
}

function LiveSingingScreen({
  song,
  pitch,
  status,
  currentTime,
  duration,
  pitchPoints,
  onStop,
}: LiveSingingScreenProps) {
  const progress = Math.min(100, (currentTime / Math.max(0.01, duration)) * 100);
  return (
    <main className="live-singing-screen">
      <header className="live-song-heading">
        <h1>{displaySongTitle(song.title)}</h1>
        <p>
          <span className="recording-dot" aria-hidden="true" />
          正在演唱
          <time>{formatTime(currentTime)}</time>
        </p>
      </header>
      <PitchTimeline
        pitch={pitch}
        currentTime={currentTime}
        userPitch={pitchPoints}
        live
      />
      <div className="live-accompaniment">
        <span className="live-pause-icon" aria-hidden="true">
          <PauseIcon />
        </span>
        <time>{formatTime(currentTime)}</time>
        <div className="live-progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <time>{formatTime(duration)}</time>
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
