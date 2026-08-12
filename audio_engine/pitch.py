from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from .wav_io import AudioData


FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class PitchTrack:
    times: FloatArray
    frequencies: FloatArray
    confidences: FloatArray
    rms: FloatArray
    hop_seconds: float

    @property
    def voiced(self) -> NDArray[np.bool_]:
        return self.frequencies > 0.0

    @property
    def duration_seconds(self) -> float:
        if self.times.size == 0:
            return 0.0
        return float(self.times[-1] + self.hop_seconds / 2.0)


def extract_pitch(
    audio: AudioData,
    *,
    min_frequency: float = 70.0,
    max_frequency: float = 700.0,
    frame_seconds: float = 0.05,
    hop_seconds: float = 0.02,
    yin_threshold: float = 0.15,
    confidence_threshold: float = 0.65,
    rms_threshold: float = 0.01,
    analysis_sample_rate: int = 8000,
) -> PitchTrack:
    """Extract a monophonic pitch track with a compact YIN implementation."""

    if min_frequency <= 0 or max_frequency <= min_frequency:
        raise ValueError("Expected 0 < min_frequency < max_frequency")
    samples, sample_rate = _resample_for_analysis(
        audio.samples, audio.sample_rate, analysis_sample_rate
    )
    frame_length = max(
        int(round(frame_seconds * sample_rate)),
        2 * int(np.ceil(sample_rate / min_frequency)) + 1,
    )
    hop_length = max(1, int(round(hop_seconds * sample_rate)))
    if samples.size < frame_length:
        samples = np.pad(samples, (0, frame_length - samples.size))

    starts = np.arange(0, samples.size - frame_length + 1, hop_length, dtype=np.int64)
    frequencies = np.zeros(starts.size, dtype=np.float64)
    confidences = np.zeros(starts.size, dtype=np.float64)
    rms_values = np.zeros(starts.size, dtype=np.float64)

    adaptive_floor = max(rms_threshold, float(np.max(np.abs(samples))) * 0.01)
    for index, start in enumerate(starts):
        frame = samples[start : start + frame_length]
        rms = float(np.sqrt(np.mean(frame * frame)))
        rms_values[index] = rms
        if rms < adaptive_floor:
            continue
        frequency, confidence = _yin_frame(
            frame,
            sample_rate,
            min_frequency=min_frequency,
            max_frequency=max_frequency,
            threshold=yin_threshold,
        )
        confidences[index] = confidence
        if confidence >= confidence_threshold:
            frequencies[index] = frequency

    times = (starts + frame_length / 2.0) / sample_rate
    frequencies = _suppress_isolated_outliers(frequencies, confidences)
    return PitchTrack(
        times=times.astype(np.float64),
        frequencies=frequencies,
        confidences=confidences,
        rms=rms_values,
        hop_seconds=hop_length / sample_rate,
    )


def frequency_to_midi(frequencies: FloatArray) -> FloatArray:
    result = np.full(frequencies.shape, np.nan, dtype=np.float64)
    valid = frequencies > 0.0
    result[valid] = 69.0 + 12.0 * np.log2(frequencies[valid] / 440.0)
    return result


def _yin_frame(
    frame: FloatArray,
    sample_rate: int,
    *,
    min_frequency: float,
    max_frequency: float,
    threshold: float,
) -> tuple[float, float]:
    centered = frame - np.mean(frame)
    tau_min = max(2, int(np.floor(sample_rate / max_frequency)))
    tau_max = min(len(centered) - 2, int(np.ceil(sample_rate / min_frequency)))
    difference = np.zeros(tau_max + 1, dtype=np.float64)
    for tau in range(1, tau_max + 1):
        delta = centered[:-tau] - centered[tau:]
        difference[tau] = float(np.dot(delta, delta))

    cumulative = np.cumsum(difference[1:])
    cmnd = np.ones(tau_max + 1, dtype=np.float64)
    nonzero = cumulative > np.finfo(np.float64).eps
    indices = np.arange(1, tau_max + 1, dtype=np.float64)
    cmnd_values = np.ones(tau_max, dtype=np.float64)
    cmnd_values[nonzero] = difference[1:][nonzero] * indices[nonzero] / cumulative[nonzero]
    cmnd[1:] = cmnd_values

    tau = tau_min
    selected: int | None = None
    while tau <= tau_max:
        if cmnd[tau] < threshold:
            while tau + 1 <= tau_max and cmnd[tau + 1] < cmnd[tau]:
                tau += 1
            selected = tau
            break
        tau += 1
    if selected is None:
        selected = int(tau_min + np.argmin(cmnd[tau_min : tau_max + 1]))

    refined_tau = _parabolic_minimum(cmnd, selected)
    confidence = float(np.clip(1.0 - cmnd[selected], 0.0, 1.0))
    frequency = float(np.clip(sample_rate / refined_tau, min_frequency, max_frequency))
    return frequency, confidence


def _parabolic_minimum(values: FloatArray, index: int) -> float:
    if index <= 0 or index >= len(values) - 1:
        return float(index)
    left, center, right = values[index - 1 : index + 2]
    denominator = left - 2.0 * center + right
    if abs(denominator) < 1e-12:
        return float(index)
    offset = 0.5 * (left - right) / denominator
    return float(index + np.clip(offset, -1.0, 1.0))


def _resample_for_analysis(
    samples: FloatArray, source_rate: int, target_rate: int
) -> tuple[FloatArray, int]:
    if source_rate <= target_rate:
        return np.asarray(samples, dtype=np.float64), source_rate
    ratio = source_rate / target_rate
    smoothing_width = max(1, int(np.floor(ratio)))
    if smoothing_width > 1:
        kernel = np.ones(smoothing_width, dtype=np.float64) / smoothing_width
        filtered = np.convolve(samples, kernel, mode="same")
    else:
        filtered = samples
    duration = len(filtered) / source_rate
    target_length = max(1, int(np.floor(duration * target_rate)))
    source_positions = np.arange(len(filtered), dtype=np.float64) / source_rate
    target_positions = np.arange(target_length, dtype=np.float64) / target_rate
    return np.interp(target_positions, source_positions, filtered), target_rate


def _suppress_isolated_outliers(
    frequencies: FloatArray, confidences: FloatArray
) -> FloatArray:
    cleaned = frequencies.copy()
    for index in range(1, len(cleaned) - 1):
        if cleaned[index] <= 0 or cleaned[index - 1] <= 0 or cleaned[index + 1] <= 0:
            continue
        neighbor_median = float(np.median([cleaned[index - 1], cleaned[index + 1]]))
        octave_distance = abs(np.log2(cleaned[index] / neighbor_median))
        if octave_distance > 0.45 and confidences[index] < max(
            confidences[index - 1], confidences[index + 1]
        ):
            cleaned[index] = neighbor_median
    return cleaned
