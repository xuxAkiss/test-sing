import type { CSSProperties } from "react";

import { assetUrl } from "../api/client";
import type { PerformanceResponse, ScoreResponse } from "../types";

interface ScoreViewProps {
  performance: PerformanceResponse;
  onRetry: () => void;
  onBack: () => void;
}

const metricLabels: Array<[keyof ScoreResponse, string]> = [
  ["pitch", "音准"],
  ["rhythm", "节奏"],
  ["completeness", "完整度"],
  ["stability", "稳定性"],
];

export function ScoreView({ performance, onRetry, onBack }: ScoreViewProps) {
  const score = performance.score;
  if (!score) {
    return null;
  }
  const overall = Math.round(score.overall);

  return (
    <main className="score-screen">
      <section className="score-summary">
        <h1>本次演唱</h1>
        <strong className="overall-score">{overall}</strong>
        <p>{feedbackFor(overall)}</p>
      </section>

      {performance.comparison_url ? (
        <figure className="comparison-frame">
          <img src={assetUrl(performance.comparison_url)} alt="参考音高与本次演唱的对比图" />
        </figure>
      ) : null}

      <dl className="score-metrics">
        {metricLabels.map(([key, label]) => {
          const value = Number(score[key]);
          const style = {
            "--metric-score": `${Math.min(100, Math.max(0, value))}%`,
          } as CSSProperties;
          return (
            <div className="score-row" key={key}>
              <dt>{label}</dt>
              <dd>
                <span className="metric-track" style={style}>
                  <span />
                </span>
                <strong>{Math.round(value)}</strong>
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="score-actions">
        <button className="primary-button" type="button" onClick={onRetry}>
          再唱一次
        </button>
        <button className="text-button" type="button" onClick={onBack}>
          返回歌曲
        </button>
      </div>
    </main>
  );
}

function feedbackFor(overall: number): string {
  if (overall >= 90) {
    return "整体稳定，细节已经很接近参考旋律";
  }
  if (overall >= 80) {
    return "节奏稳定，音准还有提升空间";
  }
  if (overall >= 70) {
    return "旋律基本完整，可以再关注音准";
  }
  return "先跟稳参考线，再逐步提升完整度";
}
