/**
 * Day bucketing for the galleries , shared by the photo booth and Activity so
 * both label and split days identically.
 *
 * Buckets by LOCAL day, deliberately. The wake-photo listing arrives bucketed
 * by UTC day, which mislabels every evening west of Greenwich: a frame captured
 * at 21:41 on the 19th in UTC-7 is 04:41 UTC on the 20th, so it landed under
 * "2026-07-20" while its own timestamp rendered "09:41 PM". Grouping here, off
 * the same epoch millis the timestamps are formatted from, keeps the heading and
 * the cells telling the same story.
 */

export interface DayBucket<T> {
  /** Local midnight of the bucket, epoch millis , also the sort key. */
  key: number;
  /** "Today", "Yesterday", or a short date. */
  label: string;
  items: T[];
}

const DAY_MS = 86_400_000;

/** Local midnight for an instant. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function labelFor(key: number, today: number): string {
  if (key === today) return "Today";
  if (key === today - DAY_MS) return "Yesterday";
  return new Date(key).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Group into newest-first local-day buckets, items newest-first within each.
 * `timeOf` reads the capture instant (epoch millis) from an item.
 */
export function groupByDay<T>(items: T[], timeOf: (item: T) => number): DayBucket<T>[] {
  const today = startOfDay(Date.now());
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    const key = startOfDay(timeOf(item));
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, list]) => ({
      key,
      label: labelFor(key, today),
      items: list.sort((a, b) => timeOf(b) - timeOf(a)),
    }));
}
