from __future__ import annotations

import math
from pathlib import Path
from typing import Iterable

import numpy as np

from .wav_io import write_wav


Note = tuple[float, float | None]


def synthesize_melody(
    notes: Iterable[Note],
    *,
    sample_rate: int = 16000,
    amplitude: float = 0.65,
    delay_seconds: float = 0.0,
    detune_cents: float = 0.0,
    vibrato_cents: float = 0.0,
) -> np.ndarray:
    parts: list[np.ndarray] = [np.zeros(int(round(delay_seconds * sample_rate)))]
    phase = 0.0
    detune_ratio = 2.0 ** (detune_cents / 1200.0)
    for duration, frequency in notes:
        length = max(1, int(round(duration * sample_rate)))
        if frequency is None:
            parts.append(np.zeros(length, dtype=np.float64))
            continue
        time = np.arange(length, dtype=np.float64) / sample_rate
        instantaneous = frequency * detune_ratio * 2.0 ** (
            vibrato_cents * np.sin(2.0 * math.pi * 5.2 * time) / 1200.0
        )
        phase_values = phase + 2.0 * math.pi * np.cumsum(instantaneous) / sample_rate
        tone = np.sin(phase_values) + 0.22 * np.sin(2.0 * phase_values)
        fade_length = min(length // 2, int(round(0.02 * sample_rate)))
        envelope = np.ones(length, dtype=np.float64)
        if fade_length:
            fade = np.linspace(0.0, 1.0, fade_length, endpoint=False)
            envelope[:fade_length] = fade
            envelope[-fade_length:] = fade[::-1]
        parts.append(amplitude * tone / 1.22 * envelope)
        phase = float(phase_values[-1] % (2.0 * math.pi))
    return np.concatenate(parts)


def create_demo_files(output_directory: str | Path) -> tuple[Path, Path]:
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    notes: list[Note] = [
        (0.25, None),
        (0.60, 220.00),
        (0.12, None),
        (0.60, 261.63),
        (0.12, None),
        (0.60, 329.63),
        (0.12, None),
        (0.80, 293.66),
        (0.25, None),
    ]
    reference = synthesize_melody(notes)
    performance = synthesize_melody(
        notes,
        delay_seconds=0.18,
        detune_cents=22.0,
        vibrato_cents=8.0,
    )
    reference_path = output / "reference.wav"
    performance_path = output / "performance.wav"
    write_wav(reference_path, reference, 16000)
    write_wav(performance_path, performance, 16000)
    return reference_path, performance_path
