from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
import shutil
from threading import Lock
from typing import Any
import uuid

from .processing import AudioProcessor, Processor
from .store import FileStore, RecordNotFound, utc_now


class ResourceConflict(RuntimeError):
    """Raised when an operation is incompatible with resource state."""


class KaraokeService:
    def __init__(
        self,
        store: FileStore,
        processor: Processor | None = None,
        *,
        worker_count: int = 1,
        synchronous: bool = False,
    ) -> None:
        self.store = store
        self.processor = processor or AudioProcessor()
        self.synchronous = synchronous
        self._executor = None if synchronous else ThreadPoolExecutor(
            max_workers=worker_count, thread_name_prefix="karaoke-worker"
        )
        self._futures: set[Future[None]] = set()
        self._future_lock = Lock()

    def submit_song(
        self,
        incoming_path: Path,
        *,
        original_filename: str,
        content_type: str | None,
        size_bytes: int,
        sha256: str,
    ) -> dict[str, Any]:
        cached_song = self.store.find_ready_song_by_hash(sha256)
        if cached_song is not None:
            incoming_path.unlink(missing_ok=True)
            job_id = uuid.uuid4().hex
            job = self.store.create_job(
                {
                    "id": job_id,
                    "kind": "song_preprocessing",
                    "status": "completed",
                    "progress": 1.0,
                    "message": "命中歌曲缓存，无需重新处理。",
                    "song_id": cached_song["id"],
                    "performance_id": None,
                    "error": None,
                    "cached": True,
                }
            )
            return job

        song_id = uuid.uuid4().hex
        job_id = uuid.uuid4().hex
        song_directory = self.store.song_directory(song_id)
        source_suffix = incoming_path.suffix.lower()
        source_path = song_directory / f"source{source_suffix}"
        self.store.create_song(
            {
                "id": song_id,
                "title": Path(original_filename).stem or "未命名歌曲",
                "original_filename": original_filename,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "sha256": sha256,
                "status": "queued",
                "source_path": self.store.relative_path(source_path),
                "duration_seconds": None,
                "separation_seconds": None,
                "reference_vocals_path": None,
                "accompaniment_path": None,
                "reference_pitch_path": None,
                "error": None,
            }
        )
        shutil.move(str(incoming_path), source_path)
        job = self.store.create_job(
            {
                "id": job_id,
                "kind": "song_preprocessing",
                "status": "queued",
                "progress": 0.02,
                "message": "歌曲已上传，等待处理。",
                "song_id": song_id,
                "performance_id": None,
                "error": None,
                "cached": False,
            }
        )
        self._dispatch(self._run_song, job_id, song_id)
        return job

    def submit_performance(
        self,
        song_id: str,
        incoming_path: Path,
        *,
        original_filename: str,
        content_type: str | None,
        size_bytes: int,
        sha256: str,
    ) -> dict[str, Any]:
        song = self.store.get_song(song_id)
        if song["status"] != "ready":
            raise ResourceConflict("歌曲尚未处理完成，暂时不能提交演唱。")

        performance_id = uuid.uuid4().hex
        job_id = uuid.uuid4().hex
        directory = self.store.performance_directory(performance_id)
        source_path = directory / f"source{incoming_path.suffix.lower()}"
        self.store.create_performance(
            {
                "id": performance_id,
                "song_id": song_id,
                "original_filename": original_filename,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "sha256": sha256,
                "status": "queued",
                "source_path": self.store.relative_path(source_path),
                "user_vocals_path": None,
                "report_path": None,
                "pitch_comparison_path": None,
                "score": None,
                "separation_seconds": None,
                "error": None,
            }
        )
        shutil.move(str(incoming_path), source_path)
        job = self.store.create_job(
            {
                "id": job_id,
                "kind": "performance_analysis",
                "status": "queued",
                "progress": 0.02,
                "message": "演唱录音已上传，等待分析。",
                "song_id": song_id,
                "performance_id": performance_id,
                "error": None,
                "cached": False,
            }
        )
        self._dispatch(self._run_performance, job_id, performance_id)
        return job

    def shutdown(self) -> None:
        if self._executor is not None:
            self._executor.shutdown(wait=False, cancel_futures=False)

    def _dispatch(self, function: Any, *arguments: Any) -> None:
        if self.synchronous:
            function(*arguments)
            return
        assert self._executor is not None
        future = self._executor.submit(function, *arguments)
        with self._future_lock:
            self._futures.add(future)
        future.add_done_callback(self._forget_future)

    def _forget_future(self, future: Future[None]) -> None:
        with self._future_lock:
            self._futures.discard(future)

    def _run_song(self, job_id: str, song_id: str) -> None:
        try:
            self.store.update_job(
                job_id,
                status="running",
                progress=0.08,
                message="歌曲处理已开始。",
                started_at=utc_now(),
            )
            song = self.store.update_song(song_id, status="processing", error=None)
            source_path = self.store.resolve_path(song["source_path"])
            output = self.store.song_directory(song_id) / "processed"

            def progress(value: float, message: str) -> None:
                self.store.update_job(
                    job_id,
                    status="running",
                    progress=round(max(0.08, min(0.99, value)), 3),
                    message=message,
                )

            result = self.processor.process_song(source_path, output, progress)
            self.store.update_song(
                song_id,
                status="ready",
                duration_seconds=round(result.duration_seconds, 3),
                separation_seconds=round(result.separation_seconds, 3),
                reference_vocals_path=self.store.relative_path(
                    result.reference_vocals_path
                ),
                accompaniment_path=self.store.relative_path(result.accompaniment_path),
                reference_pitch_path=self.store.relative_path(
                    result.reference_pitch_path
                ),
                error=None,
            )
            self.store.update_job(
                job_id,
                status="completed",
                progress=1.0,
                message="歌曲处理完成。",
                completed_at=utc_now(),
                error=None,
            )
        except Exception as exc:
            error = self._safe_error(exc)
            self.store.update_song(song_id, status="failed", error=error)
            self.store.update_job(
                job_id,
                status="failed",
                message="歌曲处理失败。",
                error=error,
                completed_at=utc_now(),
            )

    def _run_performance(self, job_id: str, performance_id: str) -> None:
        try:
            self.store.update_job(
                job_id,
                status="running",
                progress=0.08,
                message="演唱分析已开始。",
                started_at=utc_now(),
            )
            performance = self.store.update_performance(
                performance_id, status="processing", error=None
            )
            song = self.store.get_song(performance["song_id"])
            reference_path = self.store.resolve_path(song["reference_vocals_path"])
            source_path = self.store.resolve_path(performance["source_path"])
            output = self.store.performance_directory(performance_id) / "processed"

            def progress(value: float, message: str) -> None:
                self.store.update_job(
                    job_id,
                    status="running",
                    progress=round(max(0.08, min(0.99, value)), 3),
                    message=message,
                )

            result = self.processor.process_performance(
                reference_path, source_path, output, progress
            )
            self.store.update_performance(
                performance_id,
                status="ready",
                user_vocals_path=self.store.relative_path(result.user_vocals_path),
                report_path=self.store.relative_path(result.report_path),
                pitch_comparison_path=self.store.relative_path(
                    result.pitch_comparison_path
                ),
                score=result.score,
                separation_seconds=round(result.separation_seconds, 3),
                error=None,
            )
            self.store.update_job(
                job_id,
                status="completed",
                progress=1.0,
                message="演唱评分完成。",
                completed_at=utc_now(),
                error=None,
            )
        except Exception as exc:
            error = self._safe_error(exc)
            self.store.update_performance(
                performance_id, status="failed", error=error
            )
            self.store.update_job(
                job_id,
                status="failed",
                message="演唱评分失败。",
                error=error,
                completed_at=utc_now(),
            )

    def _safe_error(self, error: Exception) -> str:
        message = str(error).replace(str(self.store.root), "<data>")
        return (message or error.__class__.__name__)[:500]


__all__ = ["KaraokeService", "RecordNotFound", "ResourceConflict"]
