from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
from pathlib import Path
from typing import Any, AsyncIterator
import uuid

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings
from .processing import AudioProcessor, Processor
from .schemas import (
    HealthResponse,
    JobResponse,
    PerformanceResponse,
    ReferencePitchResponse,
    SongResponse,
    SubmissionResponse,
)
from .service import KaraokeService, ResourceConflict
from .store import FileStore, RecordNotFound


UPLOAD_CHUNK_BYTES = 1024 * 1024


def create_app(
    settings: Settings | None = None,
    *,
    processor: Processor | None = None,
    synchronous_jobs: bool = False,
) -> FastAPI:
    resolved_settings = settings or Settings.from_environment()
    store = FileStore(resolved_settings.data_root)
    store.recover_interrupted_jobs()
    service = KaraokeService(
        store,
        processor or AudioProcessor(device=resolved_settings.separation_device),
        worker_count=resolved_settings.worker_count,
        synchronous=synchronous_jobs,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        service.shutdown()

    application = FastAPI(
        title="Karaoke Pitch Lab API",
        version="0.2.0",
        description="上传歌曲、生成伴奏与参考音调线，并对用户演唱进行可解释评分。",
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.state.store = store
    application.state.service = service
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_origin_regex=resolved_settings.cors_origin_regex,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "version": application.version,
            "data_root": "configured",
        }

    @application.post(
        "/api/songs",
        status_code=status.HTTP_202_ACCEPTED,
        response_model=SubmissionResponse,
    )
    async def upload_song(file: UploadFile = File(...)) -> dict[str, object]:
        upload = await _persist_upload(file, resolved_settings, store.incoming_root)
        job = service.submit_song(**upload)
        return _submission_payload(job)

    @application.get("/api/jobs/{job_id}", response_model=JobResponse)
    def get_job(job_id: str) -> dict[str, object]:
        try:
            return _public_job(store.get_job(job_id))
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="任务不存在。") from exc

    @application.get("/api/songs/{song_id}", response_model=SongResponse)
    def get_song(song_id: str) -> dict[str, object]:
        try:
            return _public_song(store.get_song(song_id))
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="歌曲不存在。") from exc

    @application.get("/api/songs/{song_id}/accompaniment")
    def get_accompaniment(song_id: str) -> FileResponse:
        song = _ready_song(store, song_id)
        path = store.resolve_path(song["accompaniment_path"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="伴奏文件不存在。")
        return FileResponse(
            path,
            media_type="audio/wav",
            filename=f"{song['title']}-伴奏.wav",
        )

    @application.get(
        "/api/songs/{song_id}/pitch", response_model=ReferencePitchResponse
    )
    def get_reference_pitch(song_id: str) -> dict[str, Any]:
        song = _ready_song(store, song_id)
        try:
            payload = store.read_json_artifact(song["reference_pitch_path"])
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="参考音调线不存在。") from exc
        return payload

    @application.post(
        "/api/songs/{song_id}/performances",
        status_code=status.HTTP_202_ACCEPTED,
        response_model=SubmissionResponse,
    )
    async def upload_performance(
        song_id: str, file: UploadFile = File(...)
    ) -> dict[str, object]:
        try:
            song = store.get_song(song_id)
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="歌曲不存在。") from exc
        if song["status"] != "ready":
            raise HTTPException(status_code=409, detail="歌曲尚未处理完成。")
        upload = await _persist_upload(file, resolved_settings, store.incoming_root)
        try:
            job = service.submit_performance(song_id, **upload)
        except ResourceConflict as exc:
            upload["incoming_path"].unlink(missing_ok=True)
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return _submission_payload(job)

    @application.get(
        "/api/performances/{performance_id}", response_model=PerformanceResponse
    )
    def get_performance(performance_id: str) -> dict[str, object]:
        try:
            return _public_performance(store.get_performance(performance_id))
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="演唱记录不存在。") from exc

    @application.get("/api/performances/{performance_id}/comparison")
    def get_pitch_comparison(performance_id: str) -> FileResponse:
        try:
            performance = store.get_performance(performance_id)
        except RecordNotFound as exc:
            raise HTTPException(status_code=404, detail="演唱记录不存在。") from exc
        if performance["status"] != "ready":
            raise HTTPException(status_code=409, detail="演唱评分尚未完成。")
        path = store.resolve_path(performance["pitch_comparison_path"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="音调对比图不存在。")
        return FileResponse(path, media_type="image/svg+xml")

    @application.exception_handler(ResourceConflict)
    async def conflict_handler(_: Request, exc: ResourceConflict) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    return application


async def _persist_upload(
    upload: UploadFile, settings: Settings, incoming_root: Path
) -> dict[str, Any]:
    original_filename = Path(upload.filename or "upload").name
    suffix = Path(original_filename).suffix.lower()
    if suffix not in settings.allowed_extensions:
        await upload.close()
        allowed = ", ".join(sorted(settings.allowed_extensions))
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"不支持该文件格式。允许格式：{allowed}",
        )
    compatible_content_types = {
        "application/octet-stream",
        "video/mp4",
        "video/ogg",
        "video/webm",
    }
    if upload.content_type and not (
        upload.content_type.startswith("audio/")
        or upload.content_type in compatible_content_types
    ):
        await upload.close()
        raise HTTPException(status_code=415, detail="上传内容不是受支持的音频类型。")

    temporary = incoming_root / f"{uuid.uuid4().hex}{suffix}"
    size_bytes = 0
    digest = hashlib.sha256()
    try:
        with temporary.open("xb") as target:
            while chunk := await upload.read(UPLOAD_CHUNK_BYTES):
                size_bytes += len(chunk)
                if size_bytes > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "文件超过上传限制："
                            f"{settings.max_upload_bytes // (1024 * 1024)} MB。"
                        ),
                    )
                digest.update(chunk)
                target.write(chunk)
        if size_bytes == 0:
            raise HTTPException(status_code=400, detail="不能上传空文件。")
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    return {
        "incoming_path": temporary,
        "original_filename": original_filename,
        "content_type": upload.content_type,
        "size_bytes": size_bytes,
        "sha256": digest.hexdigest(),
    }


def _ready_song(store: FileStore, song_id: str) -> dict[str, Any]:
    try:
        song = store.get_song(song_id)
    except RecordNotFound as exc:
        raise HTTPException(status_code=404, detail="歌曲不存在。") from exc
    if song["status"] != "ready":
        raise HTTPException(status_code=409, detail="歌曲尚未处理完成。")
    return song


def _submission_payload(job: dict[str, Any]) -> dict[str, object]:
    return {
        "job_id": job["id"],
        "song_id": job.get("song_id"),
        "performance_id": job.get("performance_id"),
        "status": job["status"],
        "cached": bool(job.get("cached", False)),
    }


def _public_job(job: dict[str, Any]) -> dict[str, object]:
    fields = (
        "id",
        "kind",
        "status",
        "progress",
        "message",
        "song_id",
        "performance_id",
        "error",
        "cached",
        "created_at",
        "updated_at",
        "started_at",
        "completed_at",
    )
    return {field: job.get(field) for field in fields}


def _public_song(song: dict[str, Any]) -> dict[str, object]:
    payload: dict[str, object] = {
        field: song.get(field)
        for field in (
            "id",
            "title",
            "original_filename",
            "size_bytes",
            "status",
            "duration_seconds",
            "separation_seconds",
            "error",
            "created_at",
            "updated_at",
        )
    }
    if song["status"] == "ready":
        song_id = song["id"]
        payload["resources"] = {
            "accompaniment": f"/api/songs/{song_id}/accompaniment",
            "pitch": f"/api/songs/{song_id}/pitch",
        }
    else:
        payload["resources"] = None
    return payload


def _public_performance(performance: dict[str, Any]) -> dict[str, object]:
    payload: dict[str, object] = {
        field: performance.get(field)
        for field in (
            "id",
            "song_id",
            "original_filename",
            "size_bytes",
            "status",
            "score",
            "separation_seconds",
            "error",
            "created_at",
            "updated_at",
        )
    }
    if performance["status"] == "ready":
        payload["comparison_url"] = (
            f"/api/performances/{performance['id']}/comparison"
        )
    else:
        payload["comparison_url"] = None
    return payload


app = create_app()
