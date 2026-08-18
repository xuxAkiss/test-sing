import { useMemo, useState } from "react";

import { assetUrl } from "../api/client";
import {
  getLiveRecordingSupportIssue,
  useLivePerformance,
} from "../hooks/useLivePerformance";
import {
  useLatencyCalibration,
  type LatencyCalibrationStatus,
} from "../hooks/useLatencyCalibration";
import type { LatencyCalibrationResult } from "../audio/latencyCalibration";
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
  const calibration = useLatencyCalibration();
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
    latencyMs: calibration.result?.delayMs ?? 0,
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
          latencyMs={calibration.result?.delayMs ?? 0}
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
          calibrationStatus={calibration.status}
          calibrationResult={calibration.result}
          calibrationError={calibration.error}
          onCalibrate={() => void calibration.calibrate()}
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
  calibrationStatus: LatencyCalibrationStatus;
  calibrationResult: LatencyCalibrationResult | null;
  calibrationError: string | null;
  onCalibrate: () => void;
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
  calibrationStatus,
  calibrationResult,
  calibrationError,
  onCalibrate,
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
      <LatencyCalibrationPanel
        status={calibrationStatus}
        result={calibrationResult}
        error={calibrationError}
        disabled={requesting}
        onCalibrate={onCalibrate}
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
          disabled={
            requesting || unsupported || calibrationStatus === "calibrating"
          }
          onClick={onStart}
        >
          {requesting
            ? "正在连接麦克风…"
            : calibrationStatus === "calibrating"
              ? "请先完成校准…"
              : "允许麦克风并开始"}
        </button>
        <button className="secondary-button" type="button" onClick={onUpload}>
          上传已有录音
        </button>
      </div>
      <p className="microphone-explanation">
        麦克风会实时识别你的音高，并录制本次演唱用于评分
      </p>
      <p className="microphone-advice">
        请使用准备演唱时的输出设备；切换扬声器、耳机或蓝牙后需重新校准
      </p>
    </main>
  );
}

interface LatencyCalibrationPanelProps {
  status: LatencyCalibrationStatus;
  result: LatencyCalibrationResult | null;
  error: string | null;
  disabled: boolean;
  onCalibrate: () => void;
}

function LatencyCalibrationPanel({
  status,
  result,
  error,
  disabled,
  onCalibrate,
}: LatencyCalibrationPanelProps) {
  const isCalibrating = status === "calibrating";
  const description =
    status === "ready" && result
      ? `已应用 ${Math.round(result.delayMs)} ms 补偿。切换输出设备后请重新校准。`
      : status === "failed"
        ? (error ?? "设备校准没有成功，可以重试或直接开始演唱。")
        : isCalibrating
          ? "正在播放三组校准音，请保持环境安静并不要移动手机。"
          : "手机会播放三组短促校准音并用麦克风测量，约 4 秒完成。";

  return (
    <section
      className={`latency-calibration is-${status}`}
      aria-labelledby="latency-calibration-title"
    >
      <div className="latency-calibration-copy">
        <h3 id="latency-calibration-title">设备延迟校准</h3>
        <p role={status === "failed" ? "alert" : undefined}>{description}</p>
      </div>
      <div className="latency-calibration-result">
        {status === "ready" && result ? (
          <span className="latency-reading">
            <strong>{Math.round(result.delayMs)} ms</strong>
            <small>{result.spreadMs <= 30 ? "测量稳定" : "已完成校准"}</small>
          </span>
        ) : null}
        <button
          className="secondary-button latency-calibration-button"
          type="button"
          disabled={disabled || isCalibrating}
          onClick={onCalibrate}
        >
          {isCalibrating
            ? "正在校准…"
            : status === "idle"
              ? "开始校准（约 4 秒）"
              : "重新校准"}
        </button>
      </div>
    </section>
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
  latencyMs: number;
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
  latencyMs,
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
        <span>伴奏播放中</span>
        {latencyMs > 0 ? (
          <span className="live-latency-note">
            已补偿 {Math.round(latencyMs)} ms
          </span>
        ) : null}
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
