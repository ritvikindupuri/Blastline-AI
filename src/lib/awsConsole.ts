export function normalizeAwsConsoleUrl(url?: string | null) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const regionalHost = parsed.hostname.match(/^([a-z]{2}(?:-[a-z]+)+-\d)\.console\.aws\.amazon\.com$/);
    if (regionalHost) {
      parsed.hostname = "console.aws.amazon.com";
      if (!parsed.searchParams.has("region")) parsed.searchParams.set("region", regionalHost[1]);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function openAwsConsoleUrl(url?: string | null) {
  const normalized = normalizeAwsConsoleUrl(url);
  if (!normalized) return;
  window.open(normalized, "_blank", "noopener,noreferrer");
}