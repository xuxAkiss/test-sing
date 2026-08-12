import { useState } from "react";

import { assetUrl } from "../api/client";
import type { ReferencePitchResponse, SongResponse } from "../types";
import { displaySongTitle } from "../utils/songTitle";
import { AudioPlayer } from "./AudioPlayer";
import { CheckIcon, LockIcon } from "./Icons";
import { PitchTimeline } from "./PitchTimeline";

interface SongWorkspaceProps {
  song: SongResponse;
  pitch: ReferencePitchResponse;
  onStart: () => void;
  onChangeSong: () => void;
}

export function SongWorkspace({
  song,
  pitch,
  onStart,
  onChangeSong,
}: SongWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const accompaniment = song.resources?.accompaniment;

  return (
    <main className="song-workspace">
      <aside className="song-controls">
        <div className="song-heading">
          <h1>{displaySongTitle(song.title)}</h1>
          <p className="ready-status">
            <CheckIcon />
            伴奏与音调线已生成
          </p>
        </div>
        {accompaniment ? (
          <AudioPlayer
            source={assetUrl(accompaniment)}
            fallbackDuration={song.duration_seconds ?? pitch.duration_seconds}
            onTimeChange={setCurrentTime}
          />
        ) : null}
        <div className="song-actions">
          <button className="primary-button" type="button" onClick={onStart}>
            开始演唱
          </button>
          <button className="secondary-button" type="button" onClick={onChangeSong}>
            更换歌曲
          </button>
        </div>
        <p className="privacy-note song-privacy">
          <LockIcon />
          音频仅保存在本机
        </p>
      </aside>
      <section className="timeline-region">
        <PitchTimeline pitch={pitch} currentTime={currentTime} />
      </section>
    </main>
  );
}
