from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


JobStatus = Literal["queued", "running", "completed", "failed"]
ResourceStatus = Literal["queued", "processing", "ready", "failed"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    data_root: Literal["configured"]


class SubmissionResponse(BaseModel):
    job_id: str
    song_id: str | None
    performance_id: str | None
    status: JobStatus
    cached: bool


class JobResponse(BaseModel):
    id: str
    kind: Literal["song_preprocessing", "performance_analysis"]
    status: JobStatus
    progress: float = Field(ge=0.0, le=1.0)
    message: str
    song_id: str | None
    performance_id: str | None
    error: str | None
    cached: bool = False
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None


class SongResources(BaseModel):
    accompaniment: str
    pitch: str


class SongResponse(BaseModel):
    id: str
    title: str
    original_filename: str
    size_bytes: int
    status: ResourceStatus
    duration_seconds: float | None
    separation_seconds: float | None
    error: str | None
    created_at: str
    updated_at: str
    resources: SongResources | None


class ScoreResponse(BaseModel):
    overall: float
    pitch: float
    rhythm: float
    completeness: float
    stability: float
    alignment: dict[str, Any] | None = None
    diagnostics: dict[str, Any] | None = None


class PerformanceResponse(BaseModel):
    id: str
    song_id: str
    original_filename: str
    size_bytes: int
    status: ResourceStatus
    score: ScoreResponse | None
    separation_seconds: float | None
    error: str | None
    created_at: str
    updated_at: str
    comparison_url: str | None


class ReferencePitchResponse(BaseModel):
    schema_version: int
    start_seconds: float
    hop_seconds: float = Field(gt=0.0)
    duration_seconds: float = Field(ge=0.0)
    voiced_frames: int = Field(ge=0)
    minimum_midi: float | None
    maximum_midi: float | None
    frames: list[float | None]
