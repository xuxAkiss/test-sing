import { describe, expect, it, vi } from "vitest";

import { normalizeApiBaseUrl, resolveApiBaseUrl } from "./runtimeConfig";

describe("runtime API configuration", () => {
  it("accepts HTTPS and loopback HTTP origins", () => {
    expect(normalizeApiBaseUrl("https://demo.trycloudflare.com/")).toBe(
      "https://demo.trycloudflare.com",
    );
    expect(normalizeApiBaseUrl("http://127.0.0.1:8000/")).toBe(
      "http://127.0.0.1:8000",
    );
  });

  it("rejects insecure public, credentialed, and malformed URLs", () => {
    expect(normalizeApiBaseUrl("http://example.com")).toBeNull();
    expect(normalizeApiBaseUrl("https://user:secret@example.com")).toBeNull();
    expect(normalizeApiBaseUrl("not-a-url")).toBeNull();
  });

  it("prefers the query URL and persists only the normalized base", () => {
    const storage = {
      getItem: vi.fn(() => "https://stored.example.com"),
      setItem: vi.fn(),
    };

    expect(
      resolveApiBaseUrl({
        buildValue: "https://build.example.com",
        search: "?api=https%3A%2F%2Ffresh.trycloudflare.com%2F",
        storage,
      }),
    ).toBe("https://fresh.trycloudflare.com");
    expect(storage.setItem).toHaveBeenCalledWith(
      "karaoke-api-base:v1",
      "https://fresh.trycloudflare.com",
    );
  });

  it("falls back from storage to the build-time value", () => {
    expect(
      resolveApiBaseUrl({
        buildValue: "https://build.example.com",
        search: "",
        storage: { getItem: () => "https://stored.example.com", setItem: vi.fn() },
      }),
    ).toBe("https://stored.example.com");

    expect(
      resolveApiBaseUrl({
        buildValue: "https://build.example.com/",
        search: "",
        storage: { getItem: () => null, setItem: vi.fn() },
      }),
    ).toBe("https://build.example.com");
  });
});
