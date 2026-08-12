from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path


DEFAULT_AUDIO_EXTENSIONS = frozenset(
    {".wav", ".wave", ".mp3", ".m4a", ".mp4", ".aac", ".ogg", ".flac", ".webm"}
)
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://xuxakiss.github.io",
)
DEFAULT_CORS_ORIGIN_REGEX = (
    r"^https?://(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})"
    r"(?::\d+)?$"
)


@dataclass(frozen=True)
class Settings:
    data_root: Path
    max_upload_bytes: int = 300 * 1024 * 1024
    worker_count: int = 1
    separation_device: str = "cpu"
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    cors_origin_regex: str = DEFAULT_CORS_ORIGIN_REGEX
    allowed_extensions: frozenset[str] = field(
        default_factory=lambda: DEFAULT_AUDIO_EXTENSIONS
    )

    def __post_init__(self) -> None:
        if self.max_upload_bytes <= 0:
            raise ValueError("max_upload_bytes must be positive")
        if self.worker_count <= 0:
            raise ValueError("worker_count must be positive")
        if self.separation_device not in {"cpu", "cuda"}:
            raise ValueError("separation_device must be 'cpu' or 'cuda'")
        object.__setattr__(self, "data_root", self.data_root.expanduser().resolve())

    @classmethod
    def from_environment(cls) -> "Settings":
        project_root = Path(__file__).resolve().parent.parent
        data_root = Path(os.environ.get("KARAOKE_DATA_ROOT", project_root / "data"))
        max_megabytes = int(os.environ.get("KARAOKE_MAX_UPLOAD_MB", "300"))
        worker_count = int(os.environ.get("KARAOKE_WORKERS", "1"))
        device = os.environ.get("KARAOKE_SEPARATION_DEVICE", "cpu").lower()
        cors_origins = tuple(
            origin.strip().rstrip("/")
            for origin in os.environ.get(
                "KARAOKE_CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)
            ).split(",")
            if origin.strip()
        )
        cors_origin_regex = os.environ.get(
            "KARAOKE_CORS_ORIGIN_REGEX", DEFAULT_CORS_ORIGIN_REGEX
        )
        return cls(
            data_root=data_root,
            max_upload_bytes=max_megabytes * 1024 * 1024,
            worker_count=worker_count,
            separation_device=device,
            cors_origins=cors_origins,
            cors_origin_regex=cors_origin_regex,
        )
