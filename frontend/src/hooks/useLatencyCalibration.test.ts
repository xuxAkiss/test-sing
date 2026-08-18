import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLatencyCalibration } from "./useLatencyCalibration";

afterEach(() => {
  window.localStorage.clear();
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.restoreAllMocks();
});

describe("useLatencyCalibration", () => {
  it("keeps singing available when calibration is unsupported", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useLatencyCalibration());

    await act(() => result.current.calibrate());

    expect(result.current.status).toBe("failed");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toContain("直接开始演唱");
  });
});
