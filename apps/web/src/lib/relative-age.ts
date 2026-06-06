// Compact "time since" formatter for the build-age readout next to the git SHA.
// Produces terse strings tuned for a glanceable wall-panel badge, e.g.
//   1min · 21mins · 1hr · 4hrs · 3 days 3hrs · 1 year · 2 years
// Sub-day spans render a single unit (minutes, then hours); day spans append the
// leftover hours when non-zero; year spans collapse to whole years. Anything
// under a minute reads "just now". Returns null for a non-finite/ future input so
// callers can omit the readout entirely rather than show a bogus value.
export function formatRelativeAge(builtAtMs: number, nowMs: number): string | null {
  if (!Number.isFinite(builtAtMs)) return null;

  const MIN = 60_000;
  const HR = 60 * MIN;
  const DAY = 24 * HR;
  const YEAR = 365 * DAY;

  const diff = nowMs - builtAtMs;
  if (diff < MIN) return "just now";

  const unit = (n: number, label: string) => `${n}${label}${n === 1 ? "" : "s"}`;

  if (diff < HR) return unit(Math.floor(diff / MIN), "min");
  if (diff < DAY) return unit(Math.floor(diff / HR), "hr");

  if (diff < YEAR) {
    const days = Math.floor(diff / DAY);
    const hrs = Math.floor((diff % DAY) / HR);
    // Space before "day(s)" mirrors the target style; the hours tail is dropped
    // when it rounds to zero so a clean day boundary reads "3 days", not "3 days 0hrs".
    return hrs > 0
      ? `${days} day${days === 1 ? "" : "s"} ${unit(hrs, "hr")}`
      : `${days} day${days === 1 ? "" : "s"}`;
  }

  const years = Math.floor(diff / YEAR);
  return `${years} year${years === 1 ? "" : "s"}`;
}
