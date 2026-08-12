import type {
  JobResponse,
  PerformanceResponse,
  ReferencePitchResponse,
  SongResponse,
  SubmissionResponse,
} from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
  /\/$/,
  "",
) ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new ApiError(await responseMessage(response), response.status);
  }
  return (await response.json()) as T;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ?? `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

function upload(path: string, file: File): Promise<SubmissionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson<SubmissionResponse>(path, {
    method: "POST",
    body: formData,
  });
}

export function uploadSong(file: File): Promise<SubmissionResponse> {
  return upload("/api/songs", file);
}

export function getJob(jobId: string, signal?: AbortSignal): Promise<JobResponse> {
  return requestJson<JobResponse>(`/api/jobs/${jobId}`, { signal });
}

export function getSong(songId: string): Promise<SongResponse> {
  return requestJson<SongResponse>(`/api/songs/${songId}`);
}

export function getReferencePitch(
  songId: string,
): Promise<ReferencePitchResponse> {
  return requestJson<ReferencePitchResponse>(`/api/songs/${songId}/pitch`);
}

export function uploadPerformance(
  songId: string,
  file: File,
): Promise<SubmissionResponse> {
  return upload(`/api/songs/${songId}/performances`, file);
}

export function getPerformance(
  performanceId: string,
): Promise<PerformanceResponse> {
  return requestJson<PerformanceResponse>(
    `/api/performances/${performanceId}`,
  );
}

export function assetUrl(path: string): string {
  return `${API_BASE}${path}`;
}
