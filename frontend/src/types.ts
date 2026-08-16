export type JobStatus = "queued" | "running" | "completed" | "failed";
export type ResourceStatus = "queued" | "processing" | "ready" | "failed";

export interface SubmissionResponse {
  job_id: string;
  song_id: string | null;
  performance_id: string | null;
  status: JobStatus;
  cached: boolean;
}

export interface JobResponse {
  id: string;
  kind: "song_preprocessing" | "performance_analysis";
  status: JobStatus;
  progress: number;
  message: string;
  song_id: string | null;
  performance_id: string | null;
  error: string | null;
  cached: boolean;
}

export interface SongResponse {
  id: string;
  title: string;
  original_filename: string;
  size_bytes: number;
  status: ResourceStatus;
  duration_seconds: number | null;
  separation_seconds: number | null;
  error: string | null;
  resources: {
    accompaniment: string;
    pitch: string;
  } | null;
}

export interface ReferencePitchResponse {
  schema_version: number;
  source?: "separated_original_vocals" | null;
  start_seconds: number;
  hop_seconds: number;
  duration_seconds: number;
  voiced_frames: number;
  minimum_midi: number | null;
  maximum_midi: number | null;
  frames: Array<number | null>;
}

export interface LivePitchPoint {
  time: number;
  midi: number | null;
}

export type SingingMode = "full" | "segment";

export interface SingingSelection {
  mode: SingingMode;
  startSeconds: number;
  endSeconds: number;
}

export interface ScoreResponse {
  overall: number;
  pitch: number;
  rhythm: number;
  completeness: number;
  stability: number;
  alignment?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown> | null;
}

export interface PerformanceResponse {
  id: string;
  song_id: string;
  original_filename: string;
  size_bytes: number;
  status: ResourceStatus;
  score: ScoreResponse | null;
  separation_seconds: number | null;
  segment_start_seconds: number | null;
  segment_end_seconds: number | null;
  error: string | null;
  comparison_url: string | null;
}
