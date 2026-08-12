from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from threading import RLock
from typing import Any
import uuid


class RecordNotFound(KeyError):
    """Raised when a requested local metadata record does not exist."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class FileStore:
    """Small, thread-safe JSON store for the single-machine MVP."""

    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.incoming_root = self.root / "incoming"
        self.jobs_root = self.root / "jobs"
        self.songs_root = self.root / "songs"
        self.performances_root = self.root / "performances"
        self._lock = RLock()
        for directory in (
            self.root,
            self.incoming_root,
            self.jobs_root,
            self.songs_root,
            self.performances_root,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def song_directory(self, song_id: str) -> Path:
        return self.songs_root / song_id

    def performance_directory(self, performance_id: str) -> Path:
        return self.performances_root / performance_id

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._create_record(self.jobs_root / f"{payload['id']}.json", payload)

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._read_record(self.jobs_root / f"{job_id}.json", "job", job_id)

    def update_job(self, job_id: str, **changes: Any) -> dict[str, Any]:
        return self._update_record(
            self.jobs_root / f"{job_id}.json", "job", job_id, changes
        )

    def create_song(self, payload: dict[str, Any]) -> dict[str, Any]:
        directory = self.song_directory(str(payload["id"]))
        directory.mkdir(parents=True, exist_ok=False)
        return self._create_record(directory / "metadata.json", payload)

    def get_song(self, song_id: str) -> dict[str, Any]:
        return self._read_record(
            self.song_directory(song_id) / "metadata.json", "song", song_id
        )

    def update_song(self, song_id: str, **changes: Any) -> dict[str, Any]:
        return self._update_record(
            self.song_directory(song_id) / "metadata.json",
            "song",
            song_id,
            changes,
        )

    def create_performance(self, payload: dict[str, Any]) -> dict[str, Any]:
        directory = self.performance_directory(str(payload["id"]))
        directory.mkdir(parents=True, exist_ok=False)
        return self._create_record(directory / "metadata.json", payload)

    def get_performance(self, performance_id: str) -> dict[str, Any]:
        return self._read_record(
            self.performance_directory(performance_id) / "metadata.json",
            "performance",
            performance_id,
        )

    def update_performance(
        self, performance_id: str, **changes: Any
    ) -> dict[str, Any]:
        return self._update_record(
            self.performance_directory(performance_id) / "metadata.json",
            "performance",
            performance_id,
            changes,
        )

    def find_ready_song_by_hash(self, sha256: str) -> dict[str, Any] | None:
        with self._lock:
            for metadata_path in self.songs_root.glob("*/metadata.json"):
                payload = self._read_json(metadata_path)
                if payload.get("sha256") == sha256 and payload.get("status") == "ready":
                    return deepcopy(payload)
        return None

    def relative_path(self, path: Path) -> str:
        resolved = path.resolve()
        try:
            relative = resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError(f"Artifact must stay inside data root: {resolved}") from exc
        return relative.as_posix()

    def resolve_path(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Stored path escapes the data root") from exc
        return candidate

    def read_json_artifact(self, relative_path: str) -> dict[str, Any]:
        path = self.resolve_path(relative_path)
        if not path.is_file():
            raise RecordNotFound(relative_path)
        return self._read_json(path)

    def recover_interrupted_jobs(self) -> int:
        recovered = 0
        with self._lock:
            for path in self.jobs_root.glob("*.json"):
                job = self._read_json(path)
                if job.get("status") not in {"queued", "running"}:
                    continue
                job.update(
                    {
                        "status": "failed",
                        "progress": float(job.get("progress", 0.0)),
                        "message": "服务重启导致任务中断，请重新提交。",
                        "error": "interrupted_by_restart",
                        "updated_at": utc_now(),
                    }
                )
                self._atomic_write(path, job)
                recovered += 1
        return recovered

    def _create_record(
        self, path: Path, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self._lock:
            if path.exists():
                raise FileExistsError(path)
            record = deepcopy(payload)
            record.setdefault("created_at", utc_now())
            record.setdefault("updated_at", record["created_at"])
            self._atomic_write(path, record)
            return deepcopy(record)

    def _read_record(self, path: Path, kind: str, record_id: str) -> dict[str, Any]:
        with self._lock:
            if not path.is_file():
                raise RecordNotFound(f"{kind}:{record_id}")
            return deepcopy(self._read_json(path))

    def _update_record(
        self,
        path: Path,
        kind: str,
        record_id: str,
        changes: dict[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            if not path.is_file():
                raise RecordNotFound(f"{kind}:{record_id}")
            record = self._read_json(path)
            record.update(deepcopy(changes))
            record["updated_at"] = utc_now()
            self._atomic_write(path, record)
            return deepcopy(record)

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            os.replace(temporary, path)
        finally:
            if temporary.exists():
                temporary.unlink()
