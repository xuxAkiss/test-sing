import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Karaoke Pitch Lab", () => {
  it("shows the song upload entry", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "上传一首歌，生成你的音调线" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择音频" })).toBeInTheDocument();
  });

  it("rejects an unsupported upload before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<App />);
    const input = container.querySelector<HTMLInputElement>("#song-audio");

    expect(input).not.toBeNull();
    await user.upload(input as HTMLInputElement, new File(["text"], "notes.txt"));

    expect(screen.getByText("请选择 WAV、MP3、M4A、OGG 等音频文件。")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes the upload, practice, and score flow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/songs" && init?.method === "POST") {
        return jsonResponse({
          job_id: "job-song",
          song_id: "song-1",
          performance_id: null,
          status: "completed",
          cached: true,
        });
      }
      if (path === "/api/songs/song-1") {
        return jsonResponse({
          id: "song-1",
          title: "七里香",
          original_filename: "七里香.mp3",
          size_bytes: 1024,
          status: "ready",
          duration_seconds: 215,
          separation_seconds: 22,
          error: null,
          resources: {
            accompaniment: "/api/assets/song-1/accompaniment.wav",
            pitch: "/api/assets/song-1/reference_pitch.json",
          },
        });
      }
      if (path === "/api/songs/song-1/pitch") {
        return jsonResponse({
          schema_version: 1,
          start_seconds: 0,
          hop_seconds: 0.1,
          duration_seconds: 215,
          voiced_frames: 6,
          minimum_midi: 58,
          maximum_midi: 66,
          frames: [60, 60, 61, null, 64, 64, 65],
        });
      }
      if (
        path === "/api/songs/song-1/performances" &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          job_id: "job-performance",
          song_id: "song-1",
          performance_id: "performance-1",
          status: "completed",
          cached: true,
        });
      }
      if (path === "/api/performances/performance-1") {
        return jsonResponse({
          id: "performance-1",
          song_id: "song-1",
          original_filename: "演唱.m4a",
          size_bytes: 2048,
          status: "ready",
          score: {
            overall: 88.3,
            pitch: 86.4,
            rhythm: 91.2,
            completeness: 89.8,
            stability: 85.1,
          },
          separation_seconds: 18,
          error: null,
          comparison_url: "/api/assets/performance-1/comparison.png",
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<App />);
    const songInput = container.querySelector<HTMLInputElement>("#song-audio");

    await user.upload(
      songInput as HTMLInputElement,
      new File(["audio"], "七里香.mp3", { type: "audio/mpeg" }),
    );

    expect(await screen.findByRole("heading", { name: "七里香" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "参考音调线" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始演唱" }));
    expect(
      screen.getByRole("heading", { name: "上传演唱录音，获得本次评分" }),
    ).toBeInTheDocument();

    const performanceInput = container.querySelector<HTMLInputElement>(
      "#performance-audio",
    );
    await user.upload(
      performanceInput as HTMLInputElement,
      new File(["voice"], "演唱.m4a", { type: "audio/mp4" }),
    );

    expect(await screen.findByText("88")).toBeInTheDocument();
    expect(screen.getByText("节奏稳定，音准还有提升空间")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "参考音高与本次演唱的对比图" })).toHaveAttribute(
      "src",
      "/api/assets/performance-1/comparison.png",
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
