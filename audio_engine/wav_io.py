from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import wave

import numpy as np
from numpy.typing import NDArray


FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class AudioData:
    samples: FloatArray
    sample_rate: int

    @property
    def duration_seconds(self) -> float:
        return len(self.samples) / self.sample_rate


def read_wav(path: str | Path) -> AudioData:
    """Read an uncompressed PCM WAV file and return normalized mono samples."""

    wav_path = Path(path)
    try:
        with wave.open(str(wav_path), "rb") as source:
            if source.getcomptype() != "NONE":
                raise ValueError("Only uncompressed PCM WAV files are supported")
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frame_count = source.getnframes()
            raw = source.readframes(frame_count)
    except (wave.Error, EOFError) as exc:
        raise ValueError(f"Invalid WAV file: {wav_path}") from exc

    if channels < 1 or sample_rate < 1:
        raise ValueError(f"Invalid WAV metadata: {wav_path}")

    samples = _decode_pcm(raw, sample_width)
    if samples.size % channels:
        raise ValueError(f"Corrupt WAV sample data: {wav_path}")
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if samples.size == 0:
        raise ValueError(f"WAV file contains no audio: {wav_path}")

    return AudioData(samples=np.ascontiguousarray(samples), sample_rate=sample_rate)


def write_wav(path: str | Path, samples: FloatArray, sample_rate: int) -> None:
    """Write floating point mono samples as 16-bit PCM WAV."""

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(np.asarray(samples, dtype=np.float64), -1.0, 1.0)
    encoded = np.round(clipped * 32767.0).astype("<i2").tobytes()
    with wave.open(str(output_path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(encoded)


def _decode_pcm(raw: bytes, sample_width: int) -> FloatArray:
    if sample_width == 1:
        values = np.frombuffer(raw, dtype=np.uint8).astype(np.float64)
        return (values - 128.0) / 128.0
    if sample_width == 2:
        return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    if sample_width == 3:
        data = np.frombuffer(raw, dtype=np.uint8)
        if data.size % 3:
            raise ValueError("Corrupt 24-bit PCM data")
        triples = data.reshape(-1, 3).astype(np.int32)
        values = triples[:, 0] | (triples[:, 1] << 8) | (triples[:, 2] << 16)
        values = np.where(values & 0x800000, values - 0x1000000, values)
        return values.astype(np.float64) / 8388608.0
    if sample_width == 4:
        return np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2147483648.0
    raise ValueError(f"Unsupported PCM sample width: {sample_width * 8} bits")
