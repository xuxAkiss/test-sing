const PROVIDER_SUFFIX = /^(.+?)[-_—–][^-_—–]+[-_—–]\d{3,}[-_—–]\d+$/;

export function displaySongTitle(title: string): string {
  const normalized = title.trim();
  const providerMatch = PROVIDER_SUFFIX.exec(normalized);
  return providerMatch?.[1]?.trim() || normalized;
}
