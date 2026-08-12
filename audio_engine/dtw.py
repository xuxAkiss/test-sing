from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .alignment import Alignment, estimate_alignment
from .pitch import PitchTrack, frequency_to_midi


@dataclass(frozen=True)
class DtwWarpResult:
    warped_performance: PitchTrack
    alignment: Alignment
    metadata: dict[str, float | int | str]
    reference_anchor_times: np.ndarray
    performance_anchor_times: np.ndarray


def warp_performance_dtw(
    reference: PitchTrack,
    performance: PitchTrack,
    *,
    max_shift_seconds: float = 10.0,
    band_seconds: float = 12.0,
    coarse_step_seconds: float = 0.10,
) -> DtwWarpResult:
    """Warp a performance onto the reference timeline with constrained DTW."""

    if not np.isclose(reference.hop_seconds, performance.hop_seconds, atol=1e-6):
        raise ValueError("Pitch tracks must use the same hop size")
    factor = max(1, int(round(coarse_step_seconds / reference.hop_seconds)))
    ref_midi, ref_voiced = _coarsen(reference, factor)
    user_midi, user_voiced = _coarsen(performance, factor)
    seed = estimate_alignment(
        reference, performance, max_shift_seconds=max_shift_seconds
    )
    shift_bins = int(round(seed.shift_frames / factor))
    band_bins = max(2, int(round(band_seconds / (factor * reference.hop_seconds))))
    path, path_cost = _constrained_subsequence_dtw(
        ref_midi,
        ref_voiced,
        user_midi,
        user_voiced,
        shift_bins=shift_bins,
        band_bins=band_bins,
    )

    ref_bins = path[:, 0]
    user_bins = path[:, 1]
    anchor_ref_bins, inverse = np.unique(ref_bins, return_inverse=True)
    anchor_user_bins = np.zeros(anchor_ref_bins.size, dtype=np.float64)
    for index in range(anchor_ref_bins.size):
        anchor_user_bins[index] = float(np.median(user_bins[inverse == index]))
    anchor_user_bins = np.maximum.accumulate(anchor_user_bins)

    coarse_seconds = factor * reference.hop_seconds
    anchor_ref_times = (anchor_ref_bins * factor + factor / 2.0) * reference.hop_seconds
    anchor_user_times = (anchor_user_bins * factor + factor / 2.0) * performance.hop_seconds
    mapped_user_times = np.interp(
        reference.times,
        anchor_ref_times,
        anchor_user_times,
        left=np.nan,
        right=np.nan,
    )
    warped = _sample_performance(reference, performance, mapped_user_times)

    paired_midi = ~np.isnan(ref_midi[ref_bins]) & ~np.isnan(user_midi[user_bins])
    if np.any(paired_midi):
        semitone_deltas = user_midi[user_bins[paired_midi]] - ref_midi[ref_bins[paired_midi]]
        octave_shift = int(round(float(np.median(semitone_deltas)) / 12.0) * 12)
    else:
        octave_shift = seed.octave_shift_semitones

    ref_valid = reference.voiced
    user_valid = warped.voiced
    paired = ref_valid & user_valid
    pair_count = int(np.sum(paired))
    precision = pair_count / max(1, int(np.sum(user_valid)))
    recall = pair_count / max(1, int(np.sum(ref_valid)))
    voiced_f1 = 2.0 * precision * recall / max(1e-12, precision + recall)

    first_ref = float(anchor_ref_times[0])
    last_ref = float(anchor_ref_times[-1])
    first_user = float(anchor_user_times[0])
    last_user = float(anchor_user_times[-1])
    reference_span = max(coarse_seconds, last_ref - first_ref)
    tempo_ratio = (last_user - first_user) / reference_span
    path_steps = np.diff(path, axis=0)
    diagonal_steps = int(np.sum((path_steps[:, 0] == 1) & (path_steps[:, 1] == 1)))
    reference_only_steps = int(
        np.sum((path_steps[:, 0] == 1) & (path_steps[:, 1] == 0))
    )
    performance_only_steps = int(
        np.sum((path_steps[:, 0] == 0) & (path_steps[:, 1] == 1))
    )
    non_diagonal_ratio = (
        (reference_only_steps + performance_only_steps) / max(1, path_steps.shape[0])
    )
    expected_user_times = first_user + (anchor_ref_times - first_ref) * tempo_ratio
    local_warp_deviation = np.abs(anchor_user_times - expected_user_times)
    alignment = Alignment(
        shift_frames=0,
        shift_seconds=0.0,
        octave_shift_semitones=octave_shift,
        quality=float(np.clip(voiced_f1, 0.0, 1.0)),
    )
    metadata: dict[str, float | int | str] = {
        "method": "constrained_dtw",
        "coarse_step_seconds": round(coarse_seconds, 4),
        "band_seconds": round(band_seconds, 4),
        "path_points": int(path.shape[0]),
        "diagonal_steps": diagonal_steps,
        "reference_only_steps": reference_only_steps,
        "performance_only_steps": performance_only_steps,
        "non_diagonal_steps_percent": round(non_diagonal_ratio * 100.0, 3),
        "normalized_path_cost": round(path_cost / max(1, path.shape[0]), 6),
        "reference_start_seconds": round(first_ref, 4),
        "reference_end_seconds": round(last_ref, 4),
        "performance_start_seconds": round(first_user, 4),
        "performance_end_seconds": round(last_user, 4),
        "tempo_ratio": round(float(tempo_ratio), 6),
        "p95_local_warp_deviation_seconds": round(
            float(np.percentile(local_warp_deviation, 95)), 4
        ),
        "seed_shift_seconds": round(seed.shift_seconds, 4),
        "voiced_f1": round(float(voiced_f1), 6),
    }
    return DtwWarpResult(
        warped_performance=warped,
        alignment=alignment,
        metadata=metadata,
        reference_anchor_times=anchor_ref_times,
        performance_anchor_times=anchor_user_times,
    )


def _coarsen(track: PitchTrack, factor: int) -> tuple[np.ndarray, np.ndarray]:
    midi = frequency_to_midi(track.frequencies)
    bins = int(np.ceil(len(midi) / factor))
    coarse_midi = np.full(bins, np.nan, dtype=np.float64)
    voiced_ratio = np.zeros(bins, dtype=np.float64)
    for index in range(bins):
        block = midi[index * factor : (index + 1) * factor]
        valid = ~np.isnan(block)
        voiced_ratio[index] = float(np.mean(valid)) if block.size else 0.0
        if np.any(valid):
            coarse_midi[index] = float(np.median(block[valid]))
    return coarse_midi, voiced_ratio


def _constrained_subsequence_dtw(
    ref_midi: np.ndarray,
    ref_voiced: np.ndarray,
    user_midi: np.ndarray,
    user_voiced: np.ndarray,
    *,
    shift_bins: int,
    band_bins: int,
) -> tuple[np.ndarray, float]:
    n, m = len(ref_midi), len(user_midi)
    infinity = float("inf")
    previous = np.full(m + 1, infinity, dtype=np.float64)
    previous[0] = 0.0
    back = np.zeros((n + 1, m + 1), dtype=np.uint8)
    end_costs = np.full(n + 1, infinity, dtype=np.float64)

    for i in range(1, n + 1):
        current = np.full(m + 1, infinity, dtype=np.float64)
        current[0] = 0.0
        center = i + shift_bins
        start = max(1, center - band_bins)
        stop = min(m, center + band_bins)
        for j in range(start, stop + 1):
            local_cost = _frame_cost(
                ref_midi[i - 1],
                ref_voiced[i - 1],
                user_midi[j - 1],
                user_voiced[j - 1],
            )
            diagonal = previous[j - 1]
            up = previous[j] + 0.08
            left = current[j - 1] + 0.08
            if diagonal <= up and diagonal <= left:
                current[j] = local_cost + diagonal
                back[i, j] = 1
            elif up <= left:
                current[j] = local_cost + up
                back[i, j] = 2
            else:
                current[j] = local_cost + left
                back[i, j] = 3
        end_costs[i] = current[m]
        previous = current

    end_i = int(np.argmin(end_costs))
    if not np.isfinite(end_costs[end_i]):
        raise ValueError("No DTW path found; increase band_seconds or max_shift_seconds")

    coordinates: list[tuple[int, int]] = []
    i, j = end_i, m
    while i > 0 and j > 0:
        coordinates.append((i - 1, j - 1))
        move = int(back[i, j])
        if move == 1:
            i -= 1
            j -= 1
        elif move == 2:
            i -= 1
        elif move == 3:
            j -= 1
        else:
            raise ValueError("Broken DTW backtrace")
    coordinates.reverse()
    return np.asarray(coordinates, dtype=np.int64), float(end_costs[end_i])


def _frame_cost(
    ref_midi: float,
    ref_voiced: float,
    user_midi: float,
    user_voiced: float,
) -> float:
    ref_has_pitch = not np.isnan(ref_midi)
    user_has_pitch = not np.isnan(user_midi)
    voicing_cost = abs(ref_voiced - user_voiced) * 0.25
    if ref_has_pitch and user_has_pitch:
        circular_delta = abs((user_midi - ref_midi + 6.0) % 12.0 - 6.0)
        return circular_delta / 6.0 * 0.75 + voicing_cost
    if ref_has_pitch != user_has_pitch:
        return 0.85 + voicing_cost
    return 0.04 + voicing_cost


def _sample_performance(
    reference: PitchTrack,
    performance: PitchTrack,
    mapped_user_times: np.ndarray,
) -> PitchTrack:
    frequencies = np.zeros_like(reference.frequencies)
    confidences = np.zeros_like(reference.confidences)
    rms = np.zeros_like(reference.rms)
    valid = ~np.isnan(mapped_user_times)
    if np.any(valid):
        positions = np.searchsorted(performance.times, mapped_user_times[valid])
        positions = np.clip(positions, 0, len(performance.times) - 1)
        previous = np.maximum(positions - 1, 0)
        use_previous = (
            np.abs(performance.times[previous] - mapped_user_times[valid])
            < np.abs(performance.times[positions] - mapped_user_times[valid])
        )
        positions[use_previous] = previous[use_previous]
        frequencies[valid] = performance.frequencies[positions]
        confidences[valid] = performance.confidences[positions]
        rms[valid] = performance.rms[positions]
    return PitchTrack(
        times=reference.times.copy(),
        frequencies=frequencies,
        confidences=confidences,
        rms=rms,
        hop_seconds=reference.hop_seconds,
    )
