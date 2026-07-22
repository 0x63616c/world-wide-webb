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

/** A reading already bucketed into a local calendar day by the caller. */
export interface DayKeyedRow {
  /** YYYY-MM-DD in the requesting client's timezone — see services/weight-sql. */
  day: string;
  weightKg: number;
}

export function dailyMedians(rows: DayKeyedRow[]): { day: string; kg: number }[] {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const kgs = byDay.get(r.day);
    if (kgs) kgs.push(r.weightKg);
    else byDay.set(r.day, [r.weightKg]);
  }
  return [...byDay.entries()]
    .map(([day, kgs]) => ({ day, kg: median(kgs) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Window statistics. The two input sets are deliberate, not an oversight:
 *
 * - low/high come from RAW readings, because they are read as "the lightest
 *   and heaviest I have been", and a median can never be either.
 * - average/change come from DAILY MEDIANS, so a day weighed four times does
 *   not outvote a day weighed once, and change stays a day-over-day trend
 *   rather than the gap between two arbitrary weigh-ins.
 */
export function summarize(
  daily: { day: string; kg: number }[],
  rawKg: number[],
): { low: number; high: number; average: number; change: number } | null {
  const kgs = daily.map((d) => d.kg);
  const first = kgs[0];
  const last = kgs[kgs.length - 1];
  if (first === undefined || last === undefined || rawKg.length === 0) return null;
  return {
    low: Math.min(...rawKg),
    high: Math.max(...rawKg),
    average: kgs.reduce((a, b) => a + b, 0) / kgs.length,
    change: last - first,
  };
}
