const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  return `${Math.floor(delta / DAY)}d ago`;
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Human label for push lag (Zapier's Autoreplay can delay error events by
 * ~10.5h, so "when it broke" and "when we heard" genuinely differ).
 * Null when the gap is too small to matter.
 */
export function ingestLag(occurredAt: string, receivedAt: string): string | null {
  const delta = new Date(receivedAt).getTime() - new Date(occurredAt).getTime();
  if (delta < 5 * MINUTE) return null;
  if (delta < HOUR) return `received ${Math.round(delta / MINUTE)}m later`;
  const hours = Math.floor(delta / HOUR);
  const minutes = Math.round((delta % HOUR) / MINUTE);
  return `received ${hours}h${minutes > 0 ? ` ${minutes}m` : ""} later`;
}
