import { useCallback, useState } from "react";

import {
  ApiError,
  getPerformance,
  getReferencePitch,
  getSong,
  uploadPerformance,
  uploadSong,
} from "../api/client";
import type {
  JobResponse,
  PerformanceResponse,
  ReferencePitchResponse,
  SongResponse,
} from "../types";
import { useJobPolling } from "./useJobPolling";

export type WorkflowPhase =
  | "song-select"
  | "song-uploading"
  | "song-processing"
  | "song-ready"
  | "performance-select"
  | "performance-uploading"
  | "performance-processing"
  | "score-ready"
  | "error";

interface KaraokeWorkflow {
  phase: WorkflowPhase;
  job: JobResponse | null;
  song: SongResponse | null;
  pitch: ReferencePitchResponse | null;
  performance: PerformanceResponse | null;
  error: string | null;
  submitSongFile: (file: File) => Promise<void>;
  choosePerformance: () => void;
  submitPerformanceFile: (file: File) => Promise<void>;
  backToSong: () => void;
  resetSong: () => void;
  retryPerformance: () => void;
  recover: () => void;
}

export function useKaraokeWorkflow(): KaraokeWorkflow {
  const [phase, setPhase] = useState<WorkflowPhase>("song-select");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [song, setSong] = useState<SongResponse | null>(null);
  const [pitch, setPitch] = useState<ReferencePitchResponse | null>(null);
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((reason: unknown) => {
    const message =
      typeof reason === "string"
        ? reason
        : reason instanceof ApiError || reason instanceof Error
        ? reason.message
        : "出现未知错误，请稍后重试。";
    setError(message);
    setActiveJobId(null);
    setPhase("error");
  }, []);

  const loadSong = useCallback(async (songId: string) => {
    const [songResult, pitchResult] = await Promise.all([
      getSong(songId),
      getReferencePitch(songId),
    ]);
    setSong(songResult);
    setPitch(pitchResult);
    setPerformance(null);
    setJob(null);
    setActiveJobId(null);
    setPhase("song-ready");
  }, []);

  const handleJobCompleted = useCallback(
    async (completedJob: JobResponse) => {
      try {
        if (completedJob.kind === "song_preprocessing") {
          if (!completedJob.song_id) {
            throw new Error("处理结果缺少歌曲编号。");
          }
          await loadSong(completedJob.song_id);
          return;
        }
        if (!completedJob.performance_id) {
          throw new Error("评分结果缺少演唱编号。");
        }
        const result = await getPerformance(completedJob.performance_id);
        setPerformance(result);
        setJob(null);
        setActiveJobId(null);
        setPhase("score-ready");
      } catch (reason) {
        fail(reason);
      }
    },
    [fail, loadSong],
  );

  useJobPolling(activeJobId, {
    onUpdate: setJob,
    onCompleted: handleJobCompleted,
    onFailed: (failedJob) => fail(failedJob.error ?? failedJob.message),
    onRequestError: fail,
  });

  const submitSongFile = useCallback(
    async (file: File) => {
      setError(null);
      setJob(null);
      setPhase("song-uploading");
      try {
        const submission = await uploadSong(file);
        if (!submission.song_id) {
          throw new Error("上传结果缺少歌曲编号。");
        }
        if (submission.status === "completed") {
          await loadSong(submission.song_id);
          return;
        }
        setActiveJobId(submission.job_id);
        setPhase("song-processing");
      } catch (reason) {
        fail(reason);
      }
    },
    [fail, loadSong],
  );

  const submitPerformanceFile = useCallback(
    async (file: File) => {
      if (!song) {
        fail(new Error("请先处理一首歌曲。"));
        return;
      }
      setError(null);
      setJob(null);
      setPhase("performance-uploading");
      try {
        const submission = await uploadPerformance(song.id, file);
        if (submission.status === "completed" && submission.performance_id) {
          const result = await getPerformance(submission.performance_id);
          setPerformance(result);
          setPhase("score-ready");
          return;
        }
        setActiveJobId(submission.job_id);
        setPhase("performance-processing");
      } catch (reason) {
        fail(reason);
      }
    },
    [fail, song],
  );

  const choosePerformance = useCallback(() => {
    setError(null);
    setPhase("performance-select");
  }, []);

  const backToSong = useCallback(() => {
    setError(null);
    setPerformance(null);
    setActiveJobId(null);
    setJob(null);
    setPhase(song ? "song-ready" : "song-select");
  }, [song]);

  const resetSong = useCallback(() => {
    setError(null);
    setSong(null);
    setPitch(null);
    setPerformance(null);
    setActiveJobId(null);
    setJob(null);
    setPhase("song-select");
  }, []);

  const retryPerformance = useCallback(() => {
    setPerformance(null);
    setError(null);
    setPhase("performance-select");
  }, []);

  const recover = useCallback(() => {
    setError(null);
    setPhase(song ? "song-ready" : "song-select");
  }, [song]);

  return {
    phase,
    job,
    song,
    pitch,
    performance,
    error,
    submitSongFile,
    choosePerformance,
    submitPerformanceFile,
    backToSong,
    resetSong,
    retryPerformance,
    recover,
  };
}
