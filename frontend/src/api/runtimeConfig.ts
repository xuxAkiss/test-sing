const API_BASE_STORAGE_KEY = "karaoke-api-base:v1";
const BUILD_API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RuntimeApiOptions {
  buildValue?: string;
  search?: string;
  storage?: StorageLike;
}

export function normalizeApiBaseUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      parsed.hostname,
    );
    const isAllowedProtocol =
      parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback);

    if (
      !isAllowedProtocol ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return null;
  }
}

export function resolveApiBaseUrl(options: RuntimeApiOptions = {}): string {
  const search = options.search ?? browserSearch();
  const storage = options.storage ?? browserStorage();
  const queryValue = new URLSearchParams(search).get("api");
  const queryBase = normalizeApiBaseUrl(queryValue);
  const storedBase = normalizeApiBaseUrl(readStoredApiBase(storage));
  const buildBase = normalizeApiBaseUrl(options.buildValue ?? BUILD_API_BASE);

  if (queryBase && storage) {
    try {
      storage.setItem(API_BASE_STORAGE_KEY, queryBase);
    } catch {
      // Private browsing or disabled storage should not block the current session.
    }
  }

  return queryBase ?? storedBase ?? buildBase ?? "";
}

function browserSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readStoredApiBase(storage: StorageLike | undefined): string | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(API_BASE_STORAGE_KEY);
  } catch {
    return null;
  }
}
