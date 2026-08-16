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
from audio_engine.wav_io import write_wav


ProgressCallback = Callable[[float, str], None]
REFERENCE_PITCH_SCHEMA_VERSION = 2


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
        *,
        segment_start_seconds: float | None = None,
        segment_end_seconds: float | None = None,
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
        track = _clean_reference_pitch(extract_pitch(audio))
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
        *,
        segment_start_seconds: float | None = None,
        segment_end_seconds: float | None = None,
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
        analysis_reference_path = reference_vocals_path
        if segment_start_seconds is not None and segment_end_seconds is not None:
            analysis_reference_path = _write_reference_segment(
                reference_vocals_path,
                analysis_directory / "reference_segment.wav",
                segment_start_seconds,
                segment_end_seconds,
            )
        report = analyze_files(
            analysis_reference_path,
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
        "schema_version": REFERENCE_PITCH_SCHEMA_VERSION,
        "source": "separated_original_vocals",
        "start_seconds": round(float(track.times[0]), 6) if track.times.size else 0.0,
        "hop_seconds": round(float(track.hop_seconds), 6),
        "duration_seconds": round(float(track.duration_seconds), 3),
        "voiced_frames": int(np.sum(finite)),
        "minimum_midi": round(float(np.min(midi[finite])), 3) if np.any(finite) else None,
        "maximum_midi": round(float(np.max(midi[finite])), 3) if np.any(finite) else None,
        "frames": frames,
    }


def _clean_reference_pitch(track: PitchTrack) -> PitchTrack:
    """Keep confident, sustained notes from the separated original-vocal stem."""

    frequencies = track.frequencies.copy()
    confident = track.confidences >= 0.72
    frequencies[~confident] = 0.0

    minimum_run_frames = max(3, int(round(0.10 / track.hop_seconds)))
    index = 0
    while index < frequencies.size:
        if frequencies[index] <= 0:
            index += 1
            continue
        end = index + 1
        while end < frequencies.size and frequencies[end] > 0:
            end += 1
        if end - index < minimum_run_frames:
            frequencies[index:end] = 0.0
        index = end

    return PitchTrack(
        times=track.times,
        frequencies=frequencies,
        confidences=track.confidences,
        rms=track.rms,
        hop_seconds=track.hop_seconds,
    )


def _write_reference_segment(
    source_path: Path,
    destination_path: Path,
    start_seconds: float,
    end_seconds: float,
) -> Path:
    audio = read_audio(source_path)
    start_frame = max(0, int(round(start_seconds * audio.sample_rate)))
    end_frame = min(len(audio.samples), int(round(end_seconds * audio.sample_rate)))
    if end_frame <= start_frame:
        raise ValueError("所选演唱片段没有可用于评分的原唱人声。")
    write_wav(destination_path, audio.samples[start_frame:end_frame], audio.sample_rate)
    return destination_path
