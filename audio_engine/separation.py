from __future__ import annotations

from dataclasses import asdict, dataclass
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from .media import convert_to_wav


class SeparationError(RuntimeError):
    """Raised when the vocal separation process cannot complete."""


@dataclass(frozen=True)
class SeparationResult:
    source_path: str
    prepared_path: str
    vocals_path: str
    accompaniment_path: str
    model: str
    device: str
    elapsed_seconds: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def separate_vocals(
    input_path: str | Path,
    output_directory: str | Path,
    *,
    model: str = "htdemucs",
    device: str = "cpu",
    shifts: int = 0,
) -> SeparationResult:
    """Normalize an input and separate vocals from pure accompaniment leakage."""

    source = Path(input_path).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Audio file does not exist: {source}")
    if device not in {"cpu", "cuda"}:
        raise ValueError("device must be 'cpu' or 'cuda'")
    if shifts < 0:
        raise ValueError("shifts must be non-negative")

    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    prepared = output / "prepared_input.wav"
    convert_to_wav(source, prepared, sample_rate=44100, channels=2)

    runtime = find_separation_python()
    project_root = Path(__file__).resolve().parent.parent
    cache_root = project_root / ".model_cache"
    temp_root = project_root / ".tmp"
    stems_root = output / "stems"
    for directory in (cache_root, temp_root, stems_root):
        directory.mkdir(parents=True, exist_ok=True)

    environment = os.environ.copy()
    environment.update(
        {
            "TEMP": str(temp_root),
            "TMP": str(temp_root),
            "TORCH_HOME": str(cache_root / "torch"),
            "HF_HOME": str(cache_root / "huggingface"),
            "XDG_CACHE_HOME": str(cache_root),
            "HF_HUB_DISABLE_SYMLINKS_WARNING": "1",
        }
    )
    command = [
        str(runtime),
        "-m",
        "demucs",
        "--name",
        model,
        "--two-stems",
        "vocals",
        "--other-method",
        "minus",
        "--device",
        device,
        "--shifts",
        str(shifts),
        "--out",
        str(stems_root),
        str(prepared),
    ]
    started = time.perf_counter()
    result = subprocess.run(command, env=environment, check=False)
    elapsed = time.perf_counter() - started
    if result.returncode != 0:
        raise SeparationError(f"Demucs exited with code {result.returncode}")

    model_output = stems_root / model / prepared.stem
    vocals = model_output / "vocals.wav"
    accompaniment = model_output / "minus_vocals.wav"
    if not vocals.is_file() or not accompaniment.is_file():
        raise SeparationError(f"Expected Demucs output was not created under {model_output}")

    separation = SeparationResult(
        source_path=str(source),
        prepared_path=str(prepared),
        vocals_path=str(vocals),
        accompaniment_path=str(accompaniment),
        model=model,
        device=device,
        elapsed_seconds=round(elapsed, 3),
    )
    (output / "separation.json").write_text(
        json.dumps(separation.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return separation


def find_separation_python() -> Path:
    configured = os.environ.get("KARAOKE_SEPARATION_PYTHON")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if candidate.is_file():
            return candidate
        raise SeparationError(
            f"KARAOKE_SEPARATION_PYTHON does not point to a file: {candidate}"
        )

    if importlib.util.find_spec("demucs") is not None:
        return Path(sys.executable).resolve()

    project_root = Path(__file__).resolve().parent.parent
    candidates = [
        project_root / ".venv" / "Scripts" / "python.exe",
        project_root / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise SeparationError(
        "Demucs runtime was not found. Run scripts/install_separation.ps1 first."
    )
