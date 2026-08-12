import type { JobResponse } from "../types";

interface ProcessingViewProps {
  kind: "song" | "performance";
  uploading: boolean;
  job: JobResponse | null;
}

export function ProcessingView({ kind, uploading, job }: ProcessingViewProps) {
  const progress = uploading ? 0.04 : Math.max(0.06, job?.progress ?? 0.08);
  const message = uploading
    ? "正在安全上传音频……"
    : (job?.message ?? "正在等待处理任务……");

  return (
    <main className="processing-screen" aria-live="polite">
      <div className="processing-visual" aria-hidden="true">
        <div className="processing-grid" />
        <div className="processing-trace" />
        <div className="processing-playhead" />
      </div>
      <div className="processing-copy">
        <h1>{kind === "song" ? "正在处理歌曲" : "正在分析本次演唱"}</h1>
        <p>{message}</p>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="progress-value">{Math.round(progress * 100)}%</span>
      </div>
    </main>
  );
}
