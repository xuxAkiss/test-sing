import { useRef, useState } from "react";

import { LockIcon, UploadIcon } from "./Icons";

const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "wav",
  "wave",
  "mp3",
  "m4a",
  "mp4",
  "aac",
  "ogg",
  "flac",
  "webm",
]);

interface UploadViewProps {
  mode: "song" | "performance";
  onFile: (file: File) => Promise<void> | void;
  onBack?: () => void;
}

export function UploadView({ mode, onFile, onBack }: UploadViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isSong = mode === "song";
  const inputId = isSong ? "song-audio" : "performance-audio";

  const acceptFile = (file: File | undefined): void => {
    if (!file) {
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      setValidationError("请选择 WAV、MP3、M4A、OGG 等音频文件。");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setValidationError("文件不能超过 300 MB。");
      return;
    }
    if (file.size === 0) {
      setValidationError("不能上传空文件。");
      return;
    }
    setValidationError(null);
    void onFile(file);
  };

  return (
    <main className="upload-screen">
      <section className="upload-copy">
        <h1>
          {isSong ? "上传一首歌，生成你的音调线" : "上传演唱录音，获得本次评分"}
        </h1>
        <p>
          {isSong
            ? "支持 WAV、MP3、M4A、OGG，最大 300 MB"
            : "请选择在伴奏外放环境下录制的音频"}
        </p>
      </section>

      <section
        className={`upload-zone${dragActive ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          acceptFile(event.dataTransfer.files[0]);
        }}
      >
        <div className="upload-grid" aria-hidden="true" />
        <div className="upload-wave" aria-hidden="true" />
        <UploadIcon className="upload-icon" />
        <input
          ref={inputRef}
          id={inputId}
          className="visually-hidden"
          type="file"
          accept="audio/*,.m4a,.mp4,.ogg,.webm"
          onChange={(event) => {
            acceptFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          className="primary-button upload-button"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          {isSong ? "选择音频" : "选择录音"}
        </button>
        <p className="drop-helper">或将文件拖到这里</p>
        {validationError ? (
          <p className="validation-error" role="alert">
            {validationError}
          </p>
        ) : null}
      </section>

      {onBack ? (
        <button className="text-button upload-back" type="button" onClick={onBack}>
          返回歌曲
        </button>
      ) : null}

      <p className="privacy-note">
        <LockIcon />
        {isSong
          ? "原唱仅用于生成伴奏与参考旋律，音频保存在本机"
          : "录音仅用于本次评分，音频保存在本机"}
      </p>
    </main>
  );
}
