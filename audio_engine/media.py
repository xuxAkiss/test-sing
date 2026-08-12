from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from .wav_io import AudioData, read_wav


class MediaDecodeError(RuntimeError):
    """Raised when a compressed audio file cannot be decoded."""


def read_audio(path: str | Path) -> AudioData:
    """Read WAV directly or decode another media format through FFmpeg."""

    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"Audio file does not exist: {source}")
    if source.suffix.lower() in {".wav", ".wave"}:
        return read_wav(source)

    with tempfile.TemporaryDirectory(prefix="karaoke-decode-") as directory:
        decoded = Path(directory) / "decoded.wav"
        convert_to_wav(source, decoded)
        return read_wav(decoded)


def convert_to_wav(
    source: str | Path,
    destination: str | Path,
    *,
    sample_rate: int = 16000,
    channels: int = 1,
) -> Path:
    """Decode an audio file into a mono 16-bit PCM WAV without touching the source."""

    source_path = Path(source).resolve()
    destination_path = Path(destination).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"Audio file does not exist: {source_path}")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        str(channels),
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(destination_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 or not destination_path.is_file():
        details = result.stderr.strip() or f"FFmpeg exited with code {result.returncode}"
        raise MediaDecodeError(f"Could not decode {source_path.name}: {details}")
    return destination_path


def find_ffmpeg() -> Path:
    configured = os.environ.get("KARAOKE_FFMPEG")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if candidate.is_file():
            return candidate
        raise MediaDecodeError(f"KARAOKE_FFMPEG does not point to a file: {candidate}")

    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return Path(system_ffmpeg).resolve()

    project_root = Path(__file__).resolve().parent.parent
    bundled = sorted((project_root / ".vendor").glob("imageio_ffmpeg/binaries/ffmpeg*.exe"))
    if bundled:
        return bundled[0].resolve()

    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise MediaDecodeError(
            "FFmpeg is required for compressed audio. Install the media extra with "
            "`python -m pip install -e .[media]` or set KARAOKE_FFMPEG."
        ) from exc
    return Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve()
