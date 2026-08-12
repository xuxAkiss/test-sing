from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

from .alignment import estimate_alignment
from .dtw import warp_performance_dtw
from .media import read_audio
from .pitch import PitchTrack, extract_pitch
from .scoring import ScoreReport, score_performance
from .visualization import render_pitch_comparison, render_pitch_track


def analyze_files(
    reference_path: str | Path,
    performance_path: str | Path,
    output_directory: str | Path,
    *,
    min_frequency: float = 70.0,
    max_frequency: float = 700.0,
    max_shift_seconds: float = 1.5,
    alignment_method: str = "global",
    dtw_band_seconds: float = 12.0,
) -> ScoreReport:
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)

    reference_audio = read_audio(reference_path)
    performance_audio = read_audio(performance_path)
    reference_track = extract_pitch(
        reference_audio, min_frequency=min_frequency, max_frequency=max_frequency
    )
    performance_track = extract_pitch(
        performance_audio, min_frequency=min_frequency, max_frequency=max_frequency
    )
    raw_performance_track = performance_track
    dtw_metadata: dict[str, object] | None = None
    dtw_reference_times: np.ndarray | None = None
    dtw_performance_times: np.ndarray | None = None
    if alignment_method == "global":
        alignment = estimate_alignment(
            reference_track, performance_track, max_shift_seconds=max_shift_seconds
        )
    elif alignment_method == "dtw":
        dtw_result = warp_performance_dtw(
            reference_track,
            performance_track,
            max_shift_seconds=max_shift_seconds,
            band_seconds=dtw_band_seconds,
        )
        performance_track = dtw_result.warped_performance
        alignment = dtw_result.alignment
        dtw_metadata = dtw_result.metadata
        dtw_reference_times = dtw_result.reference_anchor_times
        dtw_performance_times = dtw_result.performance_anchor_times
    else:
        raise ValueError("alignment_method must be 'global' or 'dtw'")
    report = score_performance(reference_track, performance_track, alignment)
    if dtw_metadata is not None:
        report = ScoreReport(
            overall=report.overall,
            pitch=report.pitch,
            rhythm=report.rhythm,
            completeness=report.completeness,
            stability=report.stability,
            alignment={**report.alignment, **dtw_metadata},
            diagnostics=report.diagnostics,
        )

    write_pitch_csv(output / "reference_pitch.csv", reference_track)
    write_pitch_csv(output / "performance_pitch.csv", performance_track)
    if alignment_method == "dtw":
        write_pitch_csv(output / "performance_pitch_raw.csv", raw_performance_track)
        assert dtw_reference_times is not None and dtw_performance_times is not None
        write_alignment_csv(
            output / "alignment_map.csv",
            dtw_reference_times,
            dtw_performance_times,
        )
    (output / "report.json").write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    render_pitch_comparison(
        reference_track,
        performance_track,
        alignment,
        report,
        output / "pitch_comparison.svg",
    )
    return report


def inspect_audio_file(
    input_path: str | Path,
    output_directory: str | Path,
    *,
    min_frequency: float = 70.0,
    max_frequency: float = 700.0,
) -> dict[str, object]:
    """Create a pitch and signal-quality report for one recording."""

    source = Path(input_path)
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    audio = read_audio(source)
    track = extract_pitch(
        audio, min_frequency=min_frequency, max_frequency=max_frequency
    )
    samples = audio.samples
    voiced = track.voiced
    voiced_count = int(np.sum(voiced))
    voiced_ratio = float(np.mean(voiced)) if voiced.size else 0.0
    warnings: list[str] = []
    if voiced_ratio >= 0.70:
        warnings.append(
            "Pitch is detected during most of the recording. In a phone recording with "
            "external playback, accompaniment or original vocals may be contaminating the track."
        )
    boundary_hits = voiced & (
        (track.frequencies <= min_frequency * 1.01)
        | (track.frequencies >= max_frequency * 0.99)
    )
    boundary_hit_ratio = float(np.sum(boundary_hits) / max(1, voiced_count))
    if boundary_hit_ratio >= 0.10:
        warnings.append(
            "Many detected pitches are close to the configured frequency boundary. "
            "This can indicate separation artifacts or an unsuitable vocal range."
        )

    report: dict[str, object] = {
        "file": source.name,
        "duration_seconds": round(audio.duration_seconds, 3),
        "sample_rate": audio.sample_rate,
        "peak_amplitude": round(float(np.max(np.abs(samples))), 5),
        "rms_amplitude": round(float(np.sqrt(np.mean(samples * samples))), 5),
        "clipped_samples_percent": round(float(np.mean(np.abs(samples) >= 0.999)) * 100.0, 5),
        "near_silence_samples_percent": round(float(np.mean(np.abs(samples) < 0.003)) * 100.0, 3),
        "pitch_voiced_frames_percent": round(voiced_ratio * 100.0, 3),
        "pitch_voiced_frames": voiced_count,
        "pitch_boundary_hits_percent_of_voiced": round(boundary_hit_ratio * 100.0, 3),
        "median_pitch_hz": round(float(np.median(track.frequencies[voiced])), 3) if voiced_count else None,
        "median_pitch_confidence": round(float(np.median(track.confidences[voiced])), 4) if voiced_count else None,
        "warnings": warnings,
    }
    write_pitch_csv(output / "pitch_track.csv", track)
    (output / "inspection.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    render_pitch_track(track, output / "pitch_track.svg", title=source.name)
    return report


def write_pitch_csv(path: Path, track: PitchTrack) -> None:
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(["time_seconds", "frequency_hz", "confidence", "rms", "voiced"])
        for time, frequency, confidence, rms in zip(
            track.times,
            track.frequencies,
            track.confidences,
            track.rms,
            strict=True,
        ):
            writer.writerow(
                [
                    f"{time:.6f}",
                    f"{frequency:.6f}" if frequency > 0 else "",
                    f"{confidence:.6f}",
                    f"{rms:.6f}",
                    int(frequency > 0),
                ]
            )


def write_alignment_csv(
    path: Path,
    reference_times: np.ndarray,
    performance_times: np.ndarray,
) -> None:
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(["reference_time_seconds", "performance_time_seconds"])
        for reference_time, performance_time in zip(
            reference_times, performance_times, strict=True
        ):
            writer.writerow([f"{reference_time:.6f}", f"{performance_time:.6f}"])
