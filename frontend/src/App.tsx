import { AppHeader } from "./components/AppHeader";
import { ErrorView } from "./components/ErrorView";
import { PerformanceEntry } from "./components/PerformanceEntry";
import { ProcessingView } from "./components/ProcessingView";
import { ScoreView } from "./components/ScoreView";
import { SongWorkspace } from "./components/SongWorkspace";
import { UploadView } from "./components/UploadView";
import { useKaraokeWorkflow } from "./hooks/useKaraokeWorkflow";

export function App() {
  const workflow = useKaraokeWorkflow();
  const isScore = workflow.phase === "score-ready";
  const showBack =
    workflow.phase === "performance-select" ||
    workflow.phase === "score-ready" ||
    (workflow.phase === "error" && workflow.song !== null);

  return (
    <div className={`app-shell phase-${workflow.phase}`}>
      <AppHeader onBack={showBack ? workflow.backToSong : undefined} />
      {workflow.phase === "song-select" ? (
        <UploadView mode="song" onFile={workflow.submitSongFile} />
      ) : null}
      {workflow.phase === "song-uploading" || workflow.phase === "song-processing" ? (
        <ProcessingView
          kind="song"
          uploading={workflow.phase === "song-uploading"}
          job={workflow.job}
        />
      ) : null}
      {workflow.phase === "song-ready" && workflow.song && workflow.pitch ? (
        <SongWorkspace
          song={workflow.song}
          pitch={workflow.pitch}
          onStart={workflow.choosePerformance}
          onChangeSong={workflow.resetSong}
        />
      ) : null}
      {workflow.phase === "performance-select" && workflow.song && workflow.pitch ? (
        <PerformanceEntry
          song={workflow.song}
          pitch={workflow.pitch}
          onRecording={workflow.submitPerformanceFile}
        />
      ) : null}
      {workflow.phase === "performance-uploading" ||
      workflow.phase === "performance-processing" ? (
        <ProcessingView
          kind="performance"
          uploading={workflow.phase === "performance-uploading"}
          job={workflow.job}
        />
      ) : null}
      {isScore && workflow.performance ? (
        <ScoreView
          performance={workflow.performance}
          onRetry={workflow.retryPerformance}
          onBack={workflow.backToSong}
        />
      ) : null}
      {workflow.phase === "error" && workflow.error ? (
        <ErrorView message={workflow.error} onRecover={workflow.recover} />
      ) : null}
    </div>
  );
}
