from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .pitch import PitchTrack, frequency_to_midi


@dataclass(frozen=True)
class Alignment:
    shift_frames: int
    shift_seconds: float
    octave_shift_semitones: int
    quality: float


def estimate_alignment(
    reference: PitchTrack,
    performance: PitchTrack,
    *,
    max_shift_seconds: float = 1.5,
) -> Alignment:
    """Estimate a global performance delay and a stable octave displacement."""

    if not np.isclose(reference.hop_seconds, performance.hop_seconds, atol=1e-6):
        raise ValueError("Pitch tracks must use the same hop size")
    ref_midi = frequency_to_midi(reference.frequencies)
    user_midi = frequency_to_midi(performance.frequencies)
    max_shift = int(round(max_shift_seconds / reference.hop_seconds))
    minimum_pairs = max(3, int(round(0.12 / reference.hop_seconds)))

    best: tuple[float, int, int, float] | None = None
    for shift in range(-max_shift, max_shift + 1):
        ref_indices, user_indices = _aligned_indices(len(ref_midi), len(user_midi), shift)
        if ref_indices.size == 0:
            continue
        ref_valid = ~np.isnan(ref_midi[ref_indices])
        user_valid = ~np.isnan(user_midi[user_indices])
        paired = ref_valid & user_valid
        pair_count = int(np.sum(paired))
        if pair_count < minimum_pairs:
            continue

        deltas = user_midi[user_indices[paired]] - ref_midi[ref_indices[paired]]
        octave_shift = int(round(float(np.median(deltas)) / 12.0) * 12)
        absolute_cents = np.abs((deltas - octave_shift) * 100.0)
        pitch_cost = float(np.median(np.clip(absolute_cents, 0.0, 300.0)) / 300.0)

        ref_voiced = int(np.sum(ref_valid))
        user_voiced = int(np.sum(user_valid))
        recall = pair_count / max(1, ref_voiced)
        precision = pair_count / max(1, user_voiced)
        overlap_f1 = 2.0 * precision * recall / max(1e-12, precision + recall)
        cost = pitch_cost + (1.0 - overlap_f1) * 1.2 + abs(shift) * 1e-5
        if best is None or cost < best[0]:
            best = (cost, shift, octave_shift, overlap_f1)

    if best is None:
        return Alignment(shift_frames=0, shift_seconds=0.0, octave_shift_semitones=0, quality=0.0)
    _, shift, octave_shift, overlap_f1 = best
    return Alignment(
        shift_frames=shift,
        shift_seconds=shift * reference.hop_seconds,
        octave_shift_semitones=octave_shift,
        quality=float(np.clip(overlap_f1, 0.0, 1.0)),
    )


def _aligned_indices(
    reference_length: int, performance_length: int, shift: int
) -> tuple[np.ndarray, np.ndarray]:
    """Return indices where performance[j] aligns with reference[i], j=i+shift."""

    ref_start = max(0, -shift)
    ref_end = min(reference_length, performance_length - shift)
    if ref_end <= ref_start:
        empty = np.array([], dtype=np.int64)
        return empty, empty
    ref_indices = np.arange(ref_start, ref_end, dtype=np.int64)
    return ref_indices, ref_indices + shift
