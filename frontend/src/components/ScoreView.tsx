import type { CSSProperties } from "react";

import { assetUrl } from "../api/client";
import type { PerformanceResponse, ScoreResponse } from "../types";
import { buildScoreFeedback } from "../utils/scoreFeedback";
import { MusicNoteIcon } from "./Icons";

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
  const feedback = buildScoreFeedback(score);

  return (
    <main className="score-screen">
      <section className="score-summary">
        <h1>本次演唱</h1>
        <strong className="overall-score">{overall}</strong>
        <p>{feedback.summary}</p>
      </section>

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

      <section className="score-insights" aria-label="演唱反馈">
        <article className="score-insight score-insight-strength">
          <h2>这次唱得好的</h2>
          <p>{feedback.strength}</p>
        </article>
        <article className="score-insight score-insight-focus">
          <h2>下次重点练习</h2>
          <p>{feedback.focus}</p>
        </article>
        {feedback.registerNote ? (
          <p className="register-note">
            <MusicNoteIcon />
            {feedback.registerNote}
          </p>
        ) : null}
      </section>

      {performance.comparison_url ? (
        <figure className="comparison-frame" aria-label="音高对比">
          <img src={assetUrl(performance.comparison_url)} alt="参考音高与本次演唱的对比图" />
        </figure>
      ) : null}

      <div className="score-actions">
        <button className="primary-button" type="button" onClick={onRetry}>
          再唱一次
        </button>
        <button className="secondary-button" type="button" onClick={onBack}>
          返回歌曲
        </button>
      </div>
    </main>
  );
}
