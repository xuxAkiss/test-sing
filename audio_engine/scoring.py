from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .alignment import Alignment, _aligned_indices
from .pitch import PitchTrack, frequency_to_midi


@dataclass(frozen=True)
class ScoreReport:
    overall: float
    pitch: float
    rhythm: float
    completeness: float
    stability: float
    alignment: dict[str, float | int | str]
    diagnostics: dict[str, float | int]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def score_performance(
    reference: PitchTrack,
    performance: PitchTrack,
    alignment: Alignment,
    *,
    octave_equivalent: bool = True,
) -> ScoreReport:
    ref_midi = frequency_to_midi(reference.frequencies)
    user_midi = frequency_to_midi(performance.frequencies)
    ref_indices, user_indices = _aligned_indices(
        len(ref_midi), len(user_midi), alignment.shift_frames
    )

    ref_valid = ~np.isnan(ref_midi[ref_indices])
    user_valid = ~np.isnan(user_midi[user_indices])
    paired = ref_valid & user_valid
    reference_voiced_total = int(np.sum(~np.isnan(ref_midi)))
    user_voiced_total = int(np.sum(~np.isnan(user_midi)))
    pair_count = int(np.sum(paired))

    if pair_count:
        raw_signed_errors = (
            user_midi[user_indices[paired]]
            - alignment.octave_shift_semitones
            - ref_midi[ref_indices[paired]]
        ) * 100.0
        if octave_equivalent:
            signed_errors = (raw_signed_errors + 600.0) % 1200.0 - 600.0
        else:
            signed_errors = raw_signed_errors
        absolute_errors = np.abs(signed_errors)
        frame_scores = np.interp(
            absolute_errors,
            [0.0, 25.0, 50.0, 100.0, 200.0],
            [100.0, 96.0, 86.0, 55.0, 0.0],
        )
        confidence_weights = np.clip(performance.confidences[user_indices[paired]], 0.2, 1.0)
        pitch_score = float(np.average(frame_scores, weights=confidence_weights))
        median_error = float(np.median(signed_errors))
        p90_error = float(np.percentile(absolute_errors, 90))
        raw_p90_error = float(np.percentile(np.abs(raw_signed_errors), 90))
        octave_normalized_ratio = float(
            np.mean(np.abs(raw_signed_errors - signed_errors) >= 600.0)
        )
        stability_score = _stability_score(
            ref_midi[ref_indices[paired]], signed_errors, ref_indices[paired]
        )
    else:
        pitch_score = 0.0
        median_error = 0.0
        p90_error = 0.0
        raw_p90_error = 0.0
        octave_normalized_ratio = 0.0
        stability_score = 0.0

    completeness = 100.0 * pair_count / max(1, reference_voiced_total)
    precision = pair_count / max(1, user_voiced_total)
    recall = pair_count / max(1, reference_voiced_total)
    rhythm = 200.0 * precision * recall / max(1e-12, precision + recall)
    completeness = float(np.clip(completeness, 0.0, 100.0))
    rhythm = float(np.clip(rhythm, 0.0, 100.0))
    overall = (
        pitch_score * 0.55
        + rhythm * 0.20
        + completeness * 0.15
        + stability_score * 0.10
    )

    return ScoreReport(
        overall=round(float(overall), 1),
        pitch=round(pitch_score, 1),
        rhythm=round(rhythm, 1),
        completeness=round(completeness, 1),
        stability=round(stability_score, 1),
        alignment={
            "shift_frames": alignment.shift_frames,
            "shift_seconds": round(alignment.shift_seconds, 4),
            "octave_shift_semitones": alignment.octave_shift_semitones,
            "quality": round(alignment.quality, 4),
        },
        diagnostics={
            "reference_voiced_frames": reference_voiced_total,
            "performance_voiced_frames": user_voiced_total,
            "paired_frames": pair_count,
            "median_signed_error_cents": round(median_error, 2),
            "p90_absolute_error_cents": round(p90_error, 2),
            "p90_raw_absolute_error_cents": round(raw_p90_error, 2),
            "octave_normalized_frames_percent": round(octave_normalized_ratio * 100.0, 2),
            "octave_equivalent_scoring": int(octave_equivalent),
        },
    )


def _stability_score(
    reference_midi: np.ndarray, signed_errors: np.ndarray, reference_indices: np.ndarray
) -> float:
    if signed_errors.size < 2:
        return 0.0
    adjacent = np.diff(reference_indices) == 1
    stable_reference = np.abs(np.diff(reference_midi)) < 0.35
    selected = adjacent & stable_reference
    if not np.any(selected):
        return 100.0
    jitter = np.abs(np.diff(signed_errors)[selected])
    robust_jitter = float(np.percentile(jitter, 75))
    return float(np.interp(robust_jitter, [0.0, 20.0, 50.0, 100.0], [100.0, 92.0, 65.0, 0.0]))
