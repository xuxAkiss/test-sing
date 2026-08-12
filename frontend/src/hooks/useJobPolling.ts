import { useEffect, useRef } from "react";

import { getJob } from "../api/client";
import type { JobResponse } from "../types";

interface JobPollingCallbacks {
  onUpdate: (job: JobResponse) => void;
  onCompleted: (job: JobResponse) => Promise<void> | void;
  onFailed: (job: JobResponse) => void;
  onRequestError: (error: unknown) => void;
}

export function useJobPolling(
  jobId: string | null,
  callbacks: JobPollingCallbacks,
): void {
  const callbacksRef = useRef(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const poll = async (): Promise<void> => {
      try {
        const job = await getJob(jobId, controller.signal);
        if (stopped) {
          return;
        }
        callbacksRef.current.onUpdate(job);
        if (job.status === "completed") {
          await callbacksRef.current.onCompleted(job);
          return;
        }
        if (job.status === "failed") {
          callbacksRef.current.onFailed(job);
          return;
        }
        timeoutId = setTimeout(() => void poll(), 800);
      } catch (error) {
        if (!stopped) {
          callbacksRef.current.onRequestError(error);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [jobId]);
}
