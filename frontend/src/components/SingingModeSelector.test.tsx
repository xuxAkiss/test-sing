import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ReferencePitchResponse, SongResponse } from "../types";
import { PerformanceEntry } from "./PerformanceEntry";
import { suggestSegmentRange } from "../utils/singingRange";

const pitch: ReferencePitchResponse = {
  schema_version: 2,
  source: "separated_original_vocals",
  start_seconds: 0,
  hop_seconds: 1,
  duration_seconds: 60,
  voiced_frames: 20,
  minimum_midi: 58,
  maximum_midi: 64,
  frames: [
    ...Array<number | null>(20).fill(null),
    ...Array<number | null>(20).fill(60),
    ...Array<number | null>(20).fill(null),
  ],
};

const song: SongResponse = {
  id: "song-1",
  title: "七里香",
  original_filename: "七里香.mp3",
  size_bytes: 1024,
  status: "ready",
  duration_seconds: 60,
  separation_seconds: 3,
  error: null,
  resources: {
    accompaniment: "/api/songs/song-1/accompaniment",
    pitch: "/api/songs/song-1/pitch",
  },
};

describe("singing modes", () => {
  it("suggests the most vocal-dense 30 second practice range", () => {
    const selection = suggestSegmentRange(pitch, 60);

    expect(selection.mode).toBe("segment");
    expect(selection.endSeconds - selection.startSeconds).toBe(30);
    expect(selection.startSeconds).toBeGreaterThanOrEqual(10);
  });

  it("keeps the selected segment when using an uploaded recording", async () => {
    const onRecording = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <PerformanceEntry song={song} pitch={pitch} onRecording={onRecording} />,
    );

    await user.click(screen.getByRole("radio", { name: /选取段落/ }));
    expect(screen.getByText("演唱范围")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上传已有录音" }));
    const input = container.querySelector<HTMLInputElement>("#performance-audio");
    await user.upload(
      input as HTMLInputElement,
      new File(["voice"], "take.webm", { type: "audio/webm" }),
    );

    expect(onRecording).toHaveBeenCalledTimes(1);
    expect(onRecording.mock.calls[0][1]).toMatchObject({
      mode: "segment",
      startSeconds: expect.any(Number),
      endSeconds: expect.any(Number),
    });
  });
});
