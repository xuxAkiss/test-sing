from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

from audio_engine.media import read_audio
from audio_engine.pipeline import analyze_files
from audio_engine.pitch import PitchTrack, extract_pitch, frequency_to_midi
from audio_engine.separation import separate_vocals


ProgressCallback = Callable[[float, str], None]


@dataclass(frozen=True)
class SongArtifacts:
    reference_vocals_path: Path
    accompaniment_path: Path
    reference_pitch_path: Path
    duration_seconds: float
    separation_seconds: float


@dataclass(frozen=True)
class PerformanceArtifacts:
    user_vocals_path: Path
    report_path: Path
    pitch_comparison_path: Path
    score: dict[str, object]
    separation_seconds: float


class Processor(Protocol):
    def process_song(
        self, source_path: Path, output_directory: Path, progress: ProgressCallback
    ) -> SongArtifacts: ...

    def process_performance(
        self,
        reference_vocals_path: Path,
        performance_path: Path,
        output_directory: Path,
        progress: ProgressCallback,
    ) -> PerformanceArtifacts: ...


class AudioProcessor:
    def __init__(self, *, device: str = "cpu") -> None:
        self.device = device

    def process_song(
        self, source_path: Path, output_directory: Path, progress: ProgressCallback
    ) -> SongArtifacts:
        output_directory.mkdir(parents=True, exist_ok=True)
        progress(0.12, "正在准备音频并分离原唱人声……")
        separation = separate_vocals(
            source_path,
            output_directory / "separation",
            device=self.device,
        )
        progress(0.82, "正在从原唱人声生成标准音调线……")
        vocals_path = Path(separation.vocals_path)
        audio = read_audio(vocals_path)
        track = extract_pitch(audio)
        pitch_path = output_directory / "reference_pitch.json"
        pitch_path.write_text(
            json.dumps(_pitch_payload(track), ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        progress(0.97, "正在保存歌曲处理结果……")
        return SongArtifacts(
            reference_vocals_path=vocals_path,
            accompaniment_path=Path(separation.accompaniment_path),
            reference_pitch_path=pitch_path,
            duration_seconds=audio.duration_seconds,
            separation_seconds=separation.elapsed_seconds,
        )

    def process_performance(
        self,
        reference_vocals_path: Path,
        performance_path: Path,
        output_directory: Path,
        progress: ProgressCallback,
    ) -> PerformanceArtifacts:
        output_directory.mkdir(parents=True, exist_ok=True)
        progress(0.12, "正在从手机录音中分离演唱人声……")
        separation = separate_vocals(
            performance_path,
            output_directory / "separation",
            device=self.device,
        )
        progress(0.78, "正在提取音高并进行 DTW 对齐……")
        analysis_directory = output_directory / "analysis"
        report = analyze_files(
            reference_vocals_path,
            separation.vocals_path,
            analysis_directory,
            max_shift_seconds=10.0,
            alignment_method="dtw",
            dtw_band_seconds=30.0,
        )
        progress(0.97, "正在保存评分结果……")
        return PerformanceArtifacts(
            user_vocals_path=Path(separation.vocals_path),
            report_path=analysis_directory / "report.json",
            pitch_comparison_path=analysis_directory / "pitch_comparison.svg",
            score=report.to_dict(),
            separation_seconds=separation.elapsed_seconds,
        )


def _pitch_payload(track: PitchTrack) -> dict[str, object]:
    midi = frequency_to_midi(track.frequencies)
    finite = np.isfinite(midi)
    frames: list[float | None] = [
        round(float(value), 3) if is_finite else None
        for value, is_finite in zip(midi, finite, strict=True)
    ]
    return {
        "schema_version": 1,
        "start_seconds": round(float(track.times[0]), 6) if track.times.size else 0.0,
        "hop_seconds": round(float(track.hop_seconds), 6),
        "duration_seconds": round(float(track.duration_seconds), 3),
        "voiced_frames": int(np.sum(finite)),
        "minimum_midi": round(float(np.min(midi[finite])), 3) if np.any(finite) else None,
        "maximum_midi": round(float(np.max(midi[finite])), 3) if np.any(finite) else None,
        "frames": frames,
    }
