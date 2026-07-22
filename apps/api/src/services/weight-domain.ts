/** Pure weight math — no DB, no HA. Spec: docs/superpowers/specs/2026-07-21-weight-tile-design.md. */

const SANITY_BAND_KG = 5.4; // 12 lb
export const LB_PER_KG = 2.2046226218;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const upper = s[mid];
  const lower = s[mid - 1];
  if (upper === undefined) return Number.NaN;
  return s.length % 2 || lower === undefined ? upper : (lower + upper) / 2;
}

/** Band is inactive until 3 included readings exist (first-days bootstrap). */
export function isOutsideSanityBand(kg: number, recentIncludedKg: number[]): boolean {
  if (recentIncludedKg.length < 3) return false;
  return Math.abs(kg - median(recentIncludedKg)) > SANITY_BAND_KG;
}

// Server-local day; server TZ = house TZ on the homelab, acceptable per spec.
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dailyMedians(
  rows: { measuredAt: Date; weightKg: number }[],
): { day: string; kg: number }[] {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const day = localDay(r.measuredAt);
    const kgs = byDay.get(day);
    if (kgs) kgs.push(r.weightKg);
    else byDay.set(day, [r.weightKg]);
  }
  return [...byDay.entries()]
    .map(([day, kgs]) => ({ day, kg: median(kgs) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function summarize(
  daily: { day: string; kg: number }[],
): { low: number; high: number; average: number; change: number } | null {
  const kgs = daily.map((d) => d.kg);
  const first = kgs[0];
  const last = kgs[kgs.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    low: Math.min(...kgs),
    high: Math.max(...kgs),
    average: kgs.reduce((a, b) => a + b, 0) / kgs.length,
    change: last - first,
  };
}
