import { useRef, useState, type CSSProperties } from "react";

import {
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "./Icons";

interface AudioPlayerProps {
  source: string;
  fallbackDuration: number;
  onTimeChange: (seconds: number) => void;
}

export function AudioPlayer({
  source,
  fallbackDuration,
  onTimeChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const seekStyle = {
    "--seek-progress": `${(currentTime / Math.max(duration, 0.01)) * 100}%`,
  } as CSSProperties;

  const updateTime = (nextTime: number): void => {
    setCurrentTime(nextTime);
    onTimeChange(nextTime);
  };

  const togglePlayback = async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
        setPlaybackError(null);
      } catch {
        setPlaybackError("浏览器暂时无法播放伴奏，请重试。")
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (nextTime: number): void => {
    const audio = audioRef.current;
    const clamped = Math.min(Math.max(0, nextTime), duration || fallbackDuration);
    if (audio) {
      audio.currentTime = clamped;
    }
    updateTime(clamped);
  };

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) {
            setDuration(event.currentTarget.duration);
          }
        }}
        onTimeUpdate={(event) => updateTime(event.currentTarget.currentTime)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onEnded={() => {
          setIsPlaying(false);
          seekTo(0);
        }}
      />
      <div className="player-times">
        <time>{formatTime(currentTime)}</time>
        <time>{formatTime(duration)}</time>
      </div>
      <input
        className="seek-slider"
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={Math.min(currentTime, duration)}
        onChange={(event) => seekTo(Number(event.target.value))}
        aria-label="伴奏播放进度"
        style={seekStyle}
      />
      <div className="player-controls">
        <button type="button" className="skip-button" onClick={() => seekTo(currentTime - 10)} aria-label="后退十秒">
          <SkipBackIcon />
        </button>
        <button
          type="button"
          className="play-button"
          onClick={() => void togglePlayback()}
          aria-label={isPlaying ? "暂停伴奏" : "播放伴奏"}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="skip-button" onClick={() => seekTo(currentTime + 10)} aria-label="前进十秒">
          <SkipForwardIcon />
        </button>
      </div>
      {playbackError ? <p className="playback-error" role="alert">{playbackError}</p> : null}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
