# Weight stats + day-grouped Readings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the weight tile's window statistics mean what they say, move calendar-day bucketing off the server's ambient timezone and into an explicit parameter, and back the already-shipped day-grouped Readings page with a real paged API and a working Delete.

**Architecture:** Postgres does the timezone conversion (`AT TIME ZONE $tz` as a bound parameter, correct across DST); `api/src/services/weight-domain.ts` stays a pure, unit-tested statistics module operating on rows that already carry a `day` key; the panel supplies its own IANA zone on every weight procedure. Delete is a tombstone column, because ingest re-inserts hard-deleted rows.

**Tech Stack:** Bun, Drizzle ORM + drizzle-kit migrations, Postgres (CNPG), tRPC v11, React 19 + TanStack Query, Vitest, Storybook 10.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-weight-stats-and-readings-design.md`. Read it before starting.
- Backend stores and returns UTC only. No procedure, service, or domain function may read the process's ambient timezone. `new Date().getFullYear()/getMonth()/getDate()` and `toDateString()` are banned in weight code.
- The `tz` value reaches SQL as a **bound parameter**. Never string-interpolate it into a query.
- Canonical unit is kilograms. `LB_PER_KG = 2.2046226218`. Conversion to pounds happens only in `web/src/components/tiles/detail/wiring/weight.tsx`; views speak lb only.
- Down is `var(--green)`, up is `var(--red)`, flat is `var(--ink-2)`.
- IDs are `wm_<16 hex>`.
- Panel is a fixed 1366x1024 touch surface. No hover-only affordances.
- No fake or placeholder data outside `*.stories.tsx`.
- Backend code uses structured logging (`getLogger()` from `@www/logger`).
- Run `bun run typecheck` from the repo root before every commit. Commit and push to `main` after each task; pushing deploys to prod.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `api/src/db/schema.ts` | Add `deleted_at` to `weight_measurement`. |
| `api/src/db/migrations/00NN_*.sql` | Generated migration for the new column. |
| `api/src/services/weight-domain.ts` | Pure statistics. Loses `localDay`; gains day-keyed inputs and a raw-readings argument to `summarize`. |
| `api/src/services/weight-domain.test.ts` | Unit tests for the above. |
| `api/src/services/weight-sql.ts` | **New.** The one place that builds the `AT TIME ZONE` day expression and the `deleted_at IS NULL` predicate. |
| `api/src/trpc/routers/weight.ts` | `summary` and `days` take `tz`; `days` replaces `readings`; new `delete` mutation. |
| `api/src/services/weight-service.ts` | Ingest filters tombstoned rows out of the sanity-band history. |
| `web/src/components/tiles/detail/wiring/weight.tsx` | Sends `tz`, consumes `weight.days` via `useInfiniteQuery`, wires `onDelete`. Loses its browser-side grouping. |
| `web/src/components/tiles/WeightReadingsView.tsx` | Gains an `onLoadMore` scroll sentinel. |
| `web/src/components/tiles/WeightPageView.tsx` | Not-enough-data state, date-spaced x-axis, axis labels from the daily series. |

---

### Task 1: Tombstone column

Ingest polls Home Assistant's *current* sensor state every cycle and inserts with `onConflictDoNothing` keyed on `measured_at` (`api/src/services/weight-service.ts:50-61`). A hard-deleted row is therefore re-created on the next poll. The row must stay in the table, marked dead.

**Files:**
- Modify: `api/src/db/schema.ts:468-485`
- Create: `api/src/db/migrations/` (generated)
- Create: `api/src/services/weight-sql.ts`
- Modify: `api/src/services/weight-service.ts:39-44`
- Test: `api/src/__tests__/weight-sql.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `weightMeasurement.deletedAt` column; `notDeleted()` returning a Drizzle `SQL` predicate; `dayExpr(tz: string)` returning `SQL<string>`.

- [ ] **Step 1: Add the column to the schema**

In `api/src/db/schema.ts`, inside the `weightMeasurement` table definition, after the `excludedReason` line:

```ts
    // Non-null = hidden from all reads. 'sanity_band' (auto) | 'manual'.
    excludedReason: text("excluded_reason"),
    // Tombstone. A hard DELETE is not safe: ingest re-sees the same HA sensor
    // state on its next poll and re-inserts the row, because the measured_at
    // unique index is the only thing stopping it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
```

- [ ] **Step 2: Generate the migration**

Run: `cd api && bun run db:generate`
Expected: a new `src/db/migrations/00NN_<name>.sql` containing `ALTER TABLE "weight_measurement" ADD COLUMN "deleted_at" timestamp with time zone;`

Then format the generated metadata, which is otherwise rejected by lint:

Run: `cd /Users/calum/code/github.com/0x63616c/world-wide-webb && bunx biome format --write api/src/db/migrations/meta`

- [ ] **Step 3: Write the failing test for the shared SQL helpers**

Create `api/src/__tests__/weight-sql.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dayExpr, isValidTimeZone } from "../services/weight-sql";

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
  it("rejects junk and injection attempts", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("'; drop table weight_measurement; --")).toBe(false);
  });
});

describe("dayExpr", () => {
  it("binds the timezone as a parameter, never inlines it", () => {
    const { params, sql } = dayExpr("America/Los_Angeles").getSQL();
    expect(params).toContain("America/Los_Angeles");
    expect(sql).not.toContain("America/Los_Angeles");
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd api && bunx vitest run src/__tests__/weight-sql.test.ts`
Expected: FAIL — `Failed to resolve import "../services/weight-sql"`

- [ ] **Step 5: Write the helpers**

Create `api/src/services/weight-sql.ts`:

```ts
/**
 * The two predicates every weight query needs, in one place.
 *
 * A calendar day does not exist without a timezone, and the api must never
 * infer one from its own environment — so the day expression takes the zone
 * the caller supplied and hands it to Postgres as a BOUND PARAMETER. Postgres
 * applies the correct UTC offset per row, which means DST transitions are
 * handled for free and no string interpolation ever touches the query.
 */
import { isNull, sql } from "drizzle-orm";
import { weightMeasurement } from "../db/schema";

/** Local calendar day of a reading, as YYYY-MM-DD in the caller's zone. */
export function dayExpr(tz: string) {
  return sql<string>`to_char(${weightMeasurement.measuredAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
}

/** Tombstoned rows are invisible to every read. */
export function notDeleted() {
  return isNull(weightMeasurement.deletedAt);
}

/** True when Intl recognises the name, which is what Postgres also accepts. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd api && bunx vitest run src/__tests__/weight-sql.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 7: Exclude tombstoned rows from the ingest sanity band**

In `api/src/services/weight-service.ts`, change the recent-history query (currently lines 39-44) to:

```ts
  const recent = await db
    .select({ weightKg: weightMeasurement.weightKg })
    .from(weightMeasurement)
    .where(
      and(
        isNull(weightMeasurement.excludedReason),
        notDeleted(),
        gte(weightMeasurement.measuredAt, cutoff),
      ),
    );
```

and add to its imports:

```ts
import { notDeleted } from "./weight-sql";
```

- [ ] **Step 8: Typecheck and commit**

Run: `cd /Users/calum/code/github.com/0x63616c/world-wide-webb && bun run typecheck`
Expected: no errors

```bash
git add api/src/db/schema.ts api/src/db/migrations api/src/services/weight-sql.ts api/src/services/weight-service.ts api/src/__tests__/weight-sql.test.ts
git commit -m "feat(api): tombstone column for weight measurements

Ingest re-sees the same HA sensor state each poll and re-inserts on the
measured_at unique index, so a hard delete resurrects the row until the
next weigh-in. Deletes become a deleted_at tombstone instead.

Adds weight-sql.ts as the single home for the timezone day expression and
the not-deleted predicate, so no query re-derives either."
git push
```

---

### Task 2: Day bucketing moves out of ambient time

`localDay()` (`api/src/services/weight-domain.ts:22-27`) buckets days with `getFullYear/getMonth/getDate` — the api process's local time. It is correct in production only because `infra/src/services.ts:108` sets `TZ=America/Los_Angeles` on the deployment. The domain stops deciding what a day is; it receives rows already keyed.

**Files:**
- Modify: `api/src/services/weight-domain.ts:21-42`
- Modify: `api/src/services/weight-domain.test.ts:24-36`

**Interfaces:**
- Consumes: `dayExpr` from Task 1 (used by the router in Task 4, not here).
- Produces: `dailyMedians(rows: DayKeyedRow[]): { day: string; kg: number }[]` where `DayKeyedRow = { day: string; weightKg: number }`. `localDay` no longer exists.

- [ ] **Step 1: Rewrite the failing test**

Replace the whole `describe("dailyMedians", ...)` block in `api/src/services/weight-domain.test.ts` with:

```ts
describe("dailyMedians", () => {
  it("reduces same-day multiples to the median and sorts by day", () => {
    const rows = [
      { day: "2026-07-16", weightKg: 82.2 },
      { day: "2026-07-16", weightKg: 82.0 },
      { day: "2026-07-15", weightKg: 81.9 },
    ];
    expect(dailyMedians(rows)).toEqual([
      { day: "2026-07-15", kg: 81.9 },
      { day: "2026-07-16", kg: 82.1 },
    ]);
  });

  it("trusts the caller's day key rather than re-deriving one", () => {
    // Both readings are the same UTC instant bucketed into different local
    // days — exactly what a timezone boundary produces. The domain must not
    // second-guess the key it was handed.
    const rows = [
      { day: "2026-07-15", weightKg: 80.0 },
      { day: "2026-07-16", weightKg: 90.0 },
    ];
    expect(dailyMedians(rows)).toEqual([
      { day: "2026-07-15", kg: 80.0 },
      { day: "2026-07-16", kg: 90.0 },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && bunx vitest run src/services/weight-domain.test.ts`
Expected: FAIL — `dailyMedians` returns `[]` because `localDay(undefined)` throws or the rows have no `measuredAt`.

- [ ] **Step 3: Rewrite `dailyMedians` and delete `localDay`**

In `api/src/services/weight-domain.ts`, delete the `localDay` function (lines 21-27 including its comment) and replace `dailyMedians` with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && bunx vitest run src/services/weight-domain.test.ts`
Expected: PASS. The `summarize` suite still passes; the router does not compile yet, which Task 4 fixes.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/weight-domain.ts api/src/services/weight-domain.test.ts
git commit -m "refactor(api): day bucketing leaves ambient process time

localDay() read the api process's TZ env var to decide what a calendar day
was. It happened to be right because Pulumi sets TZ on the deployment;
without it every evening weigh-in counted as the next day.

dailyMedians now takes rows already keyed by day. The key comes from
Postgres, in the timezone the caller states."
git push
```

---

### Task 3: LOW/HIGH over raw readings

With four readings in one day, `summarize()` reports `low === high === average` because it is fed daily medians only (`weight-domain.ts:44-57`, `weight.ts:34-35`). Observed in production: readings of 160.2/160.4/160.8/160.9 lb reported LOW 160.6, HIGH 160.6.

**Files:**
- Modify: `api/src/services/weight-domain.ts:44-57`
- Modify: `api/src/services/weight-domain.test.ts:38-50`

**Interfaces:**
- Consumes: `dailyMedians` from Task 2.
- Produces: `summarize(daily: { day: string; kg: number }[], rawKg: number[]): { low: number; high: number; average: number; change: number } | null`.

- [ ] **Step 1: Write the failing test**

Replace the whole `describe("summarize", ...)` block in `api/src/services/weight-domain.test.ts` with:

```ts
describe("summarize", () => {
  it("low/high come from raw readings, average/change from daily medians", () => {
    const s = summarize(
      [
        { day: "2026-07-15", kg: 82.0 },
        { day: "2026-07-16", kg: 81.0 },
        { day: "2026-07-17", kg: 81.5 },
      ],
      [82.4, 81.6, 80.6, 81.4, 81.6],
    );
    expect(s).toEqual({ low: 80.6, high: 82.4, average: 81.5, change: -0.5 });
  });

  it("a single day still reports a real spread — the shipped bug", () => {
    // Four readings, one day. low/high/average used to collapse to the median.
    const s = summarize([{ day: "2026-07-22", kg: 72.85 }], [72.65, 72.75, 72.95, 73.0]);
    expect(s?.low).toBe(72.65);
    expect(s?.high).toBe(73.0);
    expect(s?.average).toBe(72.85);
    expect(s?.change).toBe(0);
  });

  it("null on empty", () => {
    expect(summarize([], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && bunx vitest run src/services/weight-domain.test.ts -t summarize`
Expected: FAIL — second test gets `low: 72.85, high: 72.85`

- [ ] **Step 3: Rewrite `summarize`**

Replace the `summarize` function in `api/src/services/weight-domain.ts` with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && bunx vitest run src/services/weight-domain.test.ts`
Expected: PASS, all suites

- [ ] **Step 5: Commit**

```bash
git add api/src/services/weight-domain.ts api/src/services/weight-domain.test.ts
git commit -m "fix(api): LOW/HIGH over raw readings, not daily medians

summarize() was fed only daily medians, so a day with four readings
reported low == high == average. Four real readings spanning 160.2-160.9 lb
displayed LOW 160.6 and HIGH 160.6.

low/high now come from the raw readings in the window; average and change
stay on daily medians so a heavily-weighed day cannot outvote a quiet one."
git push
```

---

### Task 4: `weight.summary` takes a timezone

**Files:**
- Modify: `api/src/trpc/routers/weight.ts:1-45`
- Test: `api/src/__tests__/weight-router.test.ts` (create)

**Interfaces:**
- Consumes: `dayExpr`, `notDeleted`, `isValidTimeZone` (Task 1); `dailyMedians`, `summarize` (Tasks 2-3).
- Produces: `weight.summary({ range, tz })` returning `{ latestKg, latestAt, daily, low, high, average, change }`, where `latestKg` is **the most recent day's median**, not the last raw reading.

- [ ] **Step 1: Write the failing test for timezone validation**

Create `api/src/__tests__/weight-router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tzInput } from "../trpc/routers/weight";

describe("tzInput", () => {
  it("accepts a real zone", () => {
    expect(tzInput.parse("America/Los_Angeles")).toBe("America/Los_Angeles");
  });
  it("rejects an unknown zone", () => {
    expect(() => tzInput.parse("Mars/Olympus")).toThrow();
  });
  it("rejects a SQL injection attempt", () => {
    expect(() => tzInput.parse("UTC'; drop table weight_measurement; --")).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && bunx vitest run src/__tests__/weight-router.test.ts`
Expected: FAIL — `tzInput` is not exported

- [ ] **Step 3: Rewrite the summary procedure**

Replace the top of `api/src/trpc/routers/weight.ts` down to the end of the `summary` procedure with:

```ts
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index";
import { weightMeasurement } from "../../db/schema";
import { dailyMedians, summarize } from "../../services/weight-domain";
import { dayExpr, isValidTimeZone, notDeleted } from "../../services/weight-sql";
import { publicProcedure, router } from "../init";

const RANGE_DAYS = { "7d": 7, "30d": 30, all: null } as const;

/** The panel states its own zone; the api never infers one. */
export const tzInput = z.string().refine(isValidTimeZone, {
  message: "not a recognised IANA time zone",
});

export const weightRouter = router({
  // Daily-median series + window stats for the tile and Trend page. Null until
  // the first included reading exists (day-one skeleton).
  summary: publicProcedure
    .input(z.object({ range: z.enum(["7d", "30d", "all"]), tz: tzInput }))
    .query(async ({ input }) => {
      const days = RANGE_DAYS[input.range];
      const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
      const rows = await db
        .select({
          day: dayExpr(input.tz),
          weightKg: weightMeasurement.weightKg,
        })
        .from(weightMeasurement)
        .where(
          and(
            isNull(weightMeasurement.excludedReason),
            notDeleted(),
            ...(cutoff ? [gte(weightMeasurement.measuredAt, cutoff)] : []),
          ),
        )
        .orderBy(weightMeasurement.measuredAt);
      if (rows.length === 0) return null;

      const daily = dailyMedians(rows);
      const s = summarize(
        daily,
        rows.map((r) => r.weightKg),
      );
      if (!s) return null;
      const latestDay = daily[daily.length - 1];
      if (!latestDay) return null;
      return {
        // The hero number is the latest DAY's median, so it agrees with the
        // chart and the average. It used to be the latest raw reading, which
        // disagreed with every other number on the page.
        latestKg: latestDay.kg,
        latestDay: latestDay.day,
        daily,
        ...s,
      };
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && bunx vitest run src/__tests__/weight-router.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add api/src/trpc/routers/weight.ts api/src/__tests__/weight-router.test.ts
git commit -m "feat(api): weight.summary takes the caller's timezone

Day bucketing happens in SQL via AT TIME ZONE with the zone bound as a
parameter, so Postgres applies the right offset per row and DST is handled.

The hero number becomes the latest day's median rather than the latest raw
reading, which disagreed with the chart and the average beside it."
git push
```

---

### Task 5: `weight.days` and `weight.delete`

`weight.readings` ignores the range entirely and returns every row ever (`weight.ts:49-53`). It is replaced by a day-paged procedure. Days are fetched in two queries — the distinct days for this page, then the rows belonging to them — so a page boundary can never split a day.

**Files:**
- Modify: `api/src/trpc/routers/weight.ts` (replace `readings`, keep `setExcluded`, add `delete`)
- Modify: `api/src/__tests__/weight-router.test.ts`

**Interfaces:**
- Consumes: `dayExpr`, `notDeleted`, `tzInput`.
- Produces:
  - `weight.days({ tz, cursor?: string, limit?: number })` → `{ days: { day: string; medianKg: number; dayDeltaKg: number | null; readings: { id: string; measuredAt: string; weightKg: number; excludedReason: string | null; deltaKg: number | null }[] }[]; nextCursor: string | null }`, newest day first.
  - `weight.delete({ id })` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test for day assembly**

Add to `api/src/__tests__/weight-router.test.ts`:

```ts
import { assembleDays } from "../trpc/routers/weight";

describe("assembleDays", () => {
  const rows = [
    { id: "wm_3", day: "2026-07-22", measuredAt: new Date("2026-07-22T18:43:00Z"), weightKg: 72.65, excludedReason: null },
    { id: "wm_2", day: "2026-07-22", measuredAt: new Date("2026-07-22T16:55:00Z"), weightKg: 72.95, excludedReason: null },
    { id: "wm_1", day: "2026-07-21", measuredAt: new Date("2026-07-21T15:40:00Z"), weightKg: 73.1, excludedReason: null },
  ];

  it("groups newest day first with medians and day-over-day deltas", () => {
    const days = assembleDays(rows);
    expect(days.map((d) => d.day)).toEqual(["2026-07-22", "2026-07-21"]);
    expect(days[0]?.medianKg).toBeCloseTo(72.8);
    // vs the previous RECORDED day, which may not be yesterday.
    expect(days[0]?.dayDeltaKg).toBeCloseTo(-0.3);
    // The oldest day in the page has nothing before it.
    expect(days[1]?.dayDeltaKg).toBeNull();
  });

  it("readings are newest first and delta compares to the previous included one", () => {
    const [today] = assembleDays(rows);
    expect(today?.readings.map((r) => r.id)).toEqual(["wm_3", "wm_2"]);
    expect(today?.readings[0]?.deltaKg).toBeCloseTo(-0.3);
    expect(today?.readings[1]?.deltaKg).toBeNull();
  });

  it("excluded readings are listed but do not move the median", () => {
    const withGuest = [
      { id: "wm_x", day: "2026-07-22", measuredAt: new Date("2026-07-22T15:00:00Z"), weightKg: 95, excludedReason: "sanity_band" },
      ...rows,
    ];
    const [today] = assembleDays(withGuest);
    expect(today?.readings).toHaveLength(3);
    expect(today?.medianKg).toBeCloseTo(72.8);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && bunx vitest run src/__tests__/weight-router.test.ts -t assembleDays`
Expected: FAIL — `assembleDays` is not exported

- [ ] **Step 3: Implement `assembleDays` and the two procedures**

In `api/src/trpc/routers/weight.ts`, add `median` to the domain import:

```ts
import { dailyMedians, median, summarize } from "../../services/weight-domain";
```

Add above `weightRouter`:

```ts
interface DayRow {
  id: string;
  day: string;
  measuredAt: Date;
  weightKg: number;
  excludedReason: string | null;
}

/**
 * Rows (newest first, already day-keyed) → day groups.
 *
 * The day median counts only included readings — that is the number the trend
 * line plots — while the reading list shows everything so an auto-flagged
 * outlier stays visible and reversible. dayDeltaKg compares against the
 * previous RECORDED day, which with a gap in weigh-ins spans more than 24h.
 */
export function assembleDays(rows: DayRow[]) {
  const order: string[] = [];
  const byDay = new Map<string, DayRow[]>();
  for (const r of rows) {
    const existing = byDay.get(r.day);
    if (existing) existing.push(r);
    else {
      byDay.set(r.day, [r]);
      order.push(r.day);
    }
  }

  const days = order.map((day) => {
    const dayRows = byDay.get(day) ?? [];
    const included = dayRows.filter((r) => r.excludedReason == null);
    // Deltas compare against the previous OLDER included reading, so walk the
    // day oldest-first and reverse back.
    const oldestFirst = [...dayRows].reverse();
    let prevIncludedKg: number | null = null;
    const withDeltas = oldestFirst.map((r) => {
      const deltaKg =
        r.excludedReason == null && prevIncludedKg != null ? r.weightKg - prevIncludedKg : null;
      if (r.excludedReason == null) prevIncludedKg = r.weightKg;
      return {
        id: r.id,
        measuredAt: r.measuredAt.toISOString(),
        weightKg: r.weightKg,
        excludedReason: r.excludedReason,
        deltaKg,
      };
    });
    return {
      day,
      medianKg: median(included.map((r) => r.weightKg)),
      dayDeltaKg: null as number | null,
      readings: withDeltas.reverse(),
    };
  });

  return days.map((d, i) => {
    const older = days[i + 1];
    const comparable = older && Number.isFinite(d.medianKg) && Number.isFinite(older.medianKg);
    return { ...d, dayDeltaKg: comparable ? d.medianKg - older.medianKg : null };
  });
}
```

Then replace the whole `readings` procedure with:

```ts
  // One page of days, newest first, for the Readings page. Two queries so a
  // page boundary can never split a day in half: pick the days, then fetch
  // every reading belonging to them.
  days: publicProcedure
    .input(
      z.object({
        tz: tzInput,
        /** Exclusive: return days strictly older than this YYYY-MM-DD. */
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(90).default(14),
      }),
    )
    .query(async ({ input }) => {
      const day = dayExpr(input.tz);
      const dayRows = await db
        .selectDistinct({ day })
        .from(weightMeasurement)
        .where(and(notDeleted(), ...(input.cursor ? [lt(day, input.cursor)] : [])))
        .orderBy(desc(day))
        .limit(input.limit + 1);

      // The extra row tells us whether another page exists without a count(*).
      const hasMore = dayRows.length > input.limit;
      const pageDays = dayRows.slice(0, input.limit).map((d) => d.day);
      if (pageDays.length === 0) return { days: [], nextCursor: null };

      const rows = await db
        .select({
          id: weightMeasurement.id,
          day,
          measuredAt: weightMeasurement.measuredAt,
          weightKg: weightMeasurement.weightKg,
          excludedReason: weightMeasurement.excludedReason,
        })
        .from(weightMeasurement)
        .where(and(notDeleted(), inArray(day, pageDays)))
        .orderBy(desc(weightMeasurement.measuredAt));

      return {
        days: assembleDays(rows),
        nextCursor: hasMore ? (pageDays[pageDays.length - 1] ?? null) : null,
      };
    }),
```

Add `weight.delete` after `setExcluded`:

```ts
  // Tombstone, never a hard DELETE: ingest re-inserts any row it can still see
  // in the HA sensor's current state (weight-service.ts).
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(weightMeasurement)
        .set({ deletedAt: new Date() })
        .where(eq(weightMeasurement.id, input.id));
      getLogger().info({ id: input.id }, "weight measurement deleted");
      return { ok: true } as const;
    }),
```

Update the imports at the top of the file to add what the above needs:

```ts
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { getLogger } from "@www/logger";
```

Finally, add `notDeleted()` to the `setExcluded` mutation's `where` so a tombstoned row cannot be resurrected by a toggle:

```ts
        .where(and(eq(weightMeasurement.id, input.id), notDeleted()));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && bunx vitest run src/__tests__/weight-router.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Typecheck and commit**

Run: `cd /Users/calum/code/github.com/0x63616c/world-wide-webb && bun run typecheck`
Expected: `web` fails — it still calls `weight.readings`. Task 6 fixes it. Do not commit until Task 6 if you want a green tree; otherwise commit now and finish Task 6 immediately.

```bash
git add api/src/trpc/routers/weight.ts api/src/__tests__/weight-router.test.ts
git commit -m "feat(api): paged weight.days replaces weight.readings

readings ignored the range and returned every row ever recorded. days
returns one page of whole days, newest first, each with its median and its
change against the previous recorded day.

Two queries rather than one so a page boundary cannot split a day.

Adds weight.delete as a tombstone write, and makes setExcluded refuse to
touch an already-tombstoned row."
```

---

### Task 6: Wire the panel

**Files:**
- Modify: `web/src/components/tiles/detail/wiring/weight.tsx` (whole file)
- Modify: `web/src/components/tiles/WeightReadingsView.tsx` (add `onLoadMore`)
- Modify: `web/src/components/tiles/WeightReadingsView.stories.tsx` (cover the sentinel)

**Interfaces:**
- Consumes: `weight.summary({ range, tz })`, `weight.days({ tz, cursor })`, `weight.delete({ id })`.
- Produces: nothing downstream.

- [ ] **Step 1: Add the load-more sentinel to the view**

In `web/src/components/tiles/WeightReadingsView.tsx`, add to `WeightReadingsViewProps`:

```ts
  /** Called when the end of the list scrolls into view. Omit when there is
   *  nothing more to load — the sentinel is then not rendered at all. */
  onLoadMore?: () => void;
```

Add the import:

```ts
import { useEffect, useRef, useState } from "react";
```

Inside `WeightReadingsView`, before the `return`, add:

```ts
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !onLoadMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore]);
```

and render it immediately after the `days.map(...)` block, inside the same wrapper div:

```tsx
        {onLoadMore && <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />}
```

Destructure `onLoadMore` in the component signature alongside `onDelete`.

- [ ] **Step 2: Rewrite the wiring**

Replace `web/src/components/tiles/detail/wiring/weight.tsx` entirely with:

```tsx
/**
 * Weight tile — live wiring for its two detail-page variants: "Trend"
 * (WeightPageView — range picker + chart + window stats) and "Readings"
 * (WeightReadingsView — day groups with per-reading actions).
 *
 * This layer is the presentation boundary: it states the panel's timezone on
 * every query (the api never infers one), and converts kg→lb (the views speak
 * lb only). Day grouping and all statistics happen server-side.
 */

import { useCallback, useState } from "react";
import type { WeightRange } from "@/components/tiles/WeightPageView";
import { WeightPageView } from "@/components/tiles/WeightPageView";
import type { WeightReadingDay } from "@/components/tiles/WeightReadingsView";
import { WeightReadingsView } from "@/components/tiles/WeightReadingsView";
import { LB_PER_KG } from "@/components/tiles/WeightTile";
import { formatRecency } from "@/components/tiles/WeightTileView";
import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

/** The panel's own IANA zone, e.g. "America/Los_Angeles". */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Jun 22 – Today" for the chart's bottom-right window label. */
function windowLabelOf(daily: { day: string }[], now: Date): string | null {
  const first = daily[0];
  const lastDay = daily[daily.length - 1];
  if (!first || !lastDay) return null;
  const fmt = (day: string) =>
    // day is a local YYYY-MM-DD; parse as local midnight, not UTC.
    new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = formatRecency(`${lastDay.day}T00:00:00`, now);
  return `${fmt(first.day)} – ${end}`;
}

function toViewDays(
  pages: RouterOutputs["weight"]["days"][],
  now: Date,
): WeightReadingDay[] {
  return pages.flatMap((page) =>
    page.days.map((d) => ({
      key: d.day,
      label: formatRecency(`${d.day}T00:00:00`, now),
      medianLb: d.medianKg * LB_PER_KG,
      dayDeltaLb: d.dayDeltaKg == null ? null : d.dayDeltaKg * LB_PER_KG,
      readings: d.readings.map((r) => ({
        id: r.id,
        timeLabel: new Date(r.measuredAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        lb: r.weightKg * LB_PER_KG,
        deltaLb: r.deltaKg == null ? null : r.deltaKg * LB_PER_KG,
        excluded: r.excludedReason != null,
        auto: r.excludedReason === "sanity_band",
      })),
    })),
  );
}

function useWeightVariants(): { variants: DetailVariant[]; loading: boolean } {
  const [range, setRange] = useState<WeightRange>("30d");
  const now = useNow();

  const utils = trpc.useUtils();
  const summaryQuery = trpc.weight.summary.useQuery(
    { range, tz: TZ },
    { refetchInterval: POLL.weight },
  );
  const daysQuery = trpc.weight.days.useInfiniteQuery(
    { tz: TZ },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchInterval: POLL.weight,
    },
  );
  const invalidate = () => {
    void utils.weight.summary.invalidate();
    void utils.weight.days.invalidate();
  };
  const setExcludedMutation = trpc.weight.setExcluded.useMutation({ onSettled: invalidate });
  const deleteMutation = trpc.weight.delete.useMutation({ onSettled: invalidate });

  const summary = summaryQuery.data;
  const pages = daysQuery.data?.pages;

  // Stable identity: the view observes this in an effect, so a new function
  // every render would re-create the IntersectionObserver on every frame.
  const loadMore = useCallback(() => {
    if (daysQuery.hasNextPage && !daysQuery.isFetchingNextPage) void daysQuery.fetchNextPage();
  }, [daysQuery.hasNextPage, daysQuery.isFetchingNextPage, daysQuery.fetchNextPage]);

  const variants: DetailVariant[] = [
    {
      slug: "trend",
      label: "Trend",
      render: () =>
        summary ? (
          <WeightPageView
            status={TileStatus.Populated}
            range={range}
            onRangeChange={setRange}
            lb={summary.latestKg * LB_PER_KG}
            daily={summary.daily.map((d) => ({ day: d.day, lb: d.kg * LB_PER_KG }))}
            low={summary.low * LB_PER_KG}
            high={summary.high * LB_PER_KG}
            average={summary.average * LB_PER_KG}
            change={summary.change * LB_PER_KG}
            windowLabel={windowLabelOf(summary.daily, now) ?? undefined}
          />
        ) : (
          // Null summary = day one (no included readings yet), not an error.
          <WeightPageView
            status={summaryQuery.isPending ? TileStatus.Loading : TileStatus.Populated}
            range={range}
            onRangeChange={setRange}
          />
        ),
    },
    {
      slug: "readings",
      label: "Readings",
      render: () => (
        <WeightReadingsView
          status={pages ? TileStatus.Populated : TileStatus.Loading}
          days={pages ? toViewDays(pages, now) : undefined}
          onToggle={(id, excluded) => setExcludedMutation.mutate({ id, excluded })}
          onDelete={(id) => deleteMutation.mutate({ id })}
          onLoadMore={daysQuery.hasNextPage ? loadMore : undefined}
        />
      ),
    },
  ];

  // Variants render their own skeletons; the page itself is never "loading",
  // so day one still shows the Trend/Readings switcher instead of a bare shim.
  return { variants, loading: false };
}

export const weightDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_weight",
  title: "Weight",
  defaultSlug: "trend",
  useVariants: useWeightVariants,
};
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/calum/code/github.com/0x63616c/world-wide-webb && bun run typecheck`
Expected: no errors

- [ ] **Step 4: Run the weight tests**

Run: `cd web && bunx vitest run src/components/tiles/__tests__/WeightReadingsView.stories.test.tsx src/components/tiles/__tests__/WeightTileView.stories.test.tsx --testTimeout=20000`
Expected: PASS, 13 tests

- [ ] **Step 5: Verify against the real page**

Port-forward the api and run the dev server against it (the local `:4201` is frequently another session's stale server, so use fresh ports):

```bash
kubectl port-forward -n control-center svc/api 4299:4201 &
cd web && API_PORT=4299 PORT=4288 bunx vite
```

Open `http://localhost:4288`, tap the Weight tile, then Readings. Confirm: days collapse and expand, the `…` menu offers Delete with a confirm, and the Trend tab's hero number now equals TODAY's median on the Readings tab.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/tiles/detail/wiring/weight.tsx web/src/components/tiles/WeightReadingsView.tsx web/src/components/tiles/WeightReadingsView.stories.tsx
git commit -m "feat(web): weight page consumes the paged day API

Grouping and medians move off the browser and onto the server, which now
gets the panel's IANA timezone stated explicitly on every query.

Readings pages in older days as the list scrolls, and Delete is wired to
the tombstone mutation."
git push
```

---

### Task 7: Trend chart

Two defects invisible until there was more than one day of data.

**Files:**
- Modify: `web/src/components/tiles/WeightPageView.tsx:41-49, 74-98, 188-215`
- Modify: `web/src/components/tiles/WeightPageView.stories.tsx`
- Create: `web/src/components/tiles/__tests__/WeightPageView.stories.test.tsx`

**Interfaces:**
- Consumes: `WeightPageViewProps` as it already exists.
- Produces: nothing downstream.

- [ ] **Step 1: Add the failing stories**

Add to `web/src/components/tiles/WeightPageView.stories.tsx`:

```tsx
/** One daily point: no line is meaningful, so the chart area explains itself. */
export const SingleDay: Story = {
  args: {
    status: "populated",
    range: "all",
    lb: 160.6,
    daily: [{ day: "2026-07-22", lb: 160.6 }],
    low: 160.2,
    high: 160.9,
    average: 160.6,
    change: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/Not enough data yet/)).toBeInTheDocument();
    // Stats still show — they are real even with one day.
    expect(canvas.getByText("160.2 lb")).toBeInTheDocument();
    expect(canvas.getByText("160.9 lb")).toBeInTheDocument();
  },
};

/** A skipped day must leave a real gap, not be drawn as an even interval. */
export const WithGap: Story = {
  args: {
    status: "populated",
    range: "30d",
    lb: 160.6,
    daily: [
      { day: "2026-07-14", lb: 162.4 },
      { day: "2026-07-15", lb: 162.2 },
      { day: "2026-07-22", lb: 160.6 },
    ],
    low: 160.2,
    high: 162.6,
    average: 161.7,
    change: -1.8,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const path = canvasElement.querySelector("svg path");
    expect(path).toBeTruthy();
    const [, second, third] = (path?.getAttribute("d") ?? "")
      .split(/[ML]/)
      .filter(Boolean)
      .map((p) => Number(p.split(",")[0]));
    // Jul 14→15 is one day; Jul 15→22 is seven. The second span must be far
    // wider than the first, which index-based spacing would make equal.
    expect((third ?? 0) - (second ?? 0)).toBeGreaterThan(((second ?? 0) - 16) * 3);
    expect(canvas.getByText("162.2")).toBeInTheDocument();
  },
};
```

Create `web/src/components/tiles/__tests__/WeightPageView.stories.test.tsx`:

```tsx
/**
 * Vitest component tests for WeightPageView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";
import * as stories from "../WeightPageView.stories";

const { SingleDay, WithGap } = composeStories(stories);

afterEach(cleanup);

describe("WeightPageView stories", () => {
  it("SingleDay: explains itself instead of drawing a flat line", async () => {
    const { container } = render(<SingleDay />);
    if (SingleDay.play) await SingleDay.play({ canvasElement: container });
  });

  it("WithGap: a skipped day widens the interval", async () => {
    const { container } = render(<WithGap />);
    if (WithGap.play) await WithGap.play({ canvasElement: container });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && bunx vitest run src/components/tiles/__tests__/WeightPageView.stories.test.tsx --testTimeout=20000`
Expected: FAIL — no "Not enough data yet" text; the gap assertion fails because points are evenly spaced.

- [ ] **Step 3: Space points by date**

In `web/src/components/tiles/WeightPageView.tsx`, replace `linePoints` with:

```ts
/** Position by real elapsed days, not array index — a skipped weigh-in has to
 *  read as a gap, or the line misstates how fast the weight moved. */
function linePoints(daily: { day: string; lb: number }[]): { x: number; y: number }[] {
  const lbs = daily.map((d) => d.lb);
  const min = Math.min(...lbs);
  const max = Math.max(...lbs);
  const t = daily.map((d) => new Date(`${d.day}T00:00:00`).getTime());
  const t0 = t[0] ?? 0;
  const span = (t[t.length - 1] ?? t0) - t0 || 1;
  return daily.map((d, i) => ({
    x: PAD + (((t[i] ?? t0) - t0) / span) * (W - 2 * PAD),
    y: PAD + ((max - d.lb) / (max - min || 1)) * (H - 2 * PAD),
  }));
}
```

- [ ] **Step 4: Add the not-enough-data state and fix the axis labels**

In the same file, replace the body from `const lbs = daily.map(...)` through `const last = pts[pts.length - 1];` with:

```ts
  const lbs = daily.map((d) => d.lb);
  // Below two daily points there is no line to draw: one dot on an axis whose
  // min and max labels are identical reads as a broken chart, not as "no data
  // yet". Matches what 3e68f7ff6 did for the tile sparkline.
  const enoughForChart = daily.length >= 2;
  const pts = enoughForChart ? linePoints(daily) : [];
  const dailyMin = Math.min(...lbs);
  const dailyMax = Math.max(...lbs);
  const iMin = lbs.indexOf(dailyMin);
  const iMax = lbs.indexOf(dailyMax);
  const gridMin = pts[iMin];
  const gridMax = pts[iMax];
  const last = pts[pts.length - 1];
```

Replace the entire chart container — everything from `{/* Chart fills the space between picker and stats */}` down to the `</div>` that closes it (currently lines 137-230) — with:

```tsx
      {/* Chart fills the space between picker and stats */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {enoughForChart ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: "100%", display: "block" }}
              aria-hidden="true"
            >
              {gridMax && (
                <line
                  x1={PAD}
                  x2={W - PAD}
                  y1={gridMax.y}
                  y2={gridMax.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              )}
              {gridMin && (
                <line
                  x1={PAD}
                  x2={W - PAD}
                  y1={gridMin.y}
                  y2={gridMin.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              )}
              <path
                d={pathFrom(pts)}
                fill="none"
                stroke="var(--acc)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </svg>
            {/* Round latest-point dot — outside the stretched svg so it stays round */}
            {last && (
              <span
                style={{
                  position: "absolute",
                  left: `${(last.x / W) * 100}%`,
                  top: `${(last.y / H) * 100}%`,
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  background: "var(--acc)",
                  transform: "translate(-50%, -50%)",
                }}
              />
            )}
            {/* Axis labels describe the DAILY series, which is what the line
                plots. low/high are raw-reading figures and no longer sit on it. */}
            {gridMax && (
              <span
                className="mono"
                style={{
                  position: "absolute",
                  left: 0,
                  top: `calc(${(gridMax.y / H) * 100}% - 20px)`,
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                {dailyMax.toFixed(1)}
              </span>
            )}
            {gridMin && (
              <span
                className="mono"
                style={{
                  position: "absolute",
                  left: 0,
                  top: `calc(${(gridMin.y / H) * 100}% + 8px)`,
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                {dailyMin.toFixed(1)}
              </span>
            )}
          </>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 15, color: "var(--ink-2)" }}>Not enough data yet</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
              The trend starts once you have weighed in on a second day.
            </span>
          </div>
        )}
        {windowLabel && (
          <span
            className="mono"
            style={{
              position: "absolute",
              right: 0,
              bottom: -18,
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {windowLabel}
          </span>
        )}
      </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bunx vitest run src/components/tiles/__tests__/WeightPageView.stories.test.tsx --testTimeout=20000`
Expected: PASS, 2 tests

- [ ] **Step 6: Typecheck, screenshot, commit**

Run: `cd /Users/calum/code/github.com/0x63616c/world-wide-webb && bun run typecheck`
Expected: no errors

Screenshot the Trend tab in the running dev app (see Task 6 Step 5) and confirm the one-day state reads as "Not enough data yet" rather than a flat line with two identical axis labels.

```bash
git add web/src/components/tiles/WeightPageView.tsx web/src/components/tiles/WeightPageView.stories.tsx web/src/components/tiles/__tests__/WeightPageView.stories.test.tsx
git commit -m "fix(web): trend chart stops lying with sparse data

Points were spaced by array index, so a skipped weigh-in was drawn as an
ordinary interval and the line misstated the rate of change. They are now
positioned by elapsed time.

Below two daily points the chart area says so instead of drawing one dot on
an axis whose min and max labels are the same number.

Axis labels come from the daily series rather than the low/high stats,
which now describe raw readings and no longer sit on the line."
git push
```

---

## Verification

After Task 7, confirm end to end:

- [ ] `bun run typecheck` from the repo root — no errors
- [ ] `cd api && bunx vitest run` — all pass
- [ ] `cd web && bunx vitest run src/components/tiles --testTimeout=20000` — all pass
- [ ] `bunx knip --no-progress` — no unused exports (tag any deliberate surface `@public`)
- [ ] On the running panel: Trend hero number equals TODAY's median on Readings; LOW/HIGH bracket the day's raw readings rather than equalling the median; deleting a reading removes it and it does **not** reappear within a few minutes (the ingest poll interval)
- [ ] `kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c "select id, deleted_at from weight_measurement order by measured_at desc;"` — the deleted row is present with a non-null `deleted_at`

## Known follow-up, out of scope

Ingest may be dropping readings: `weight-service.ts` keys `measured_at` off the HA sensor's `last_updated`, so two readings sharing a timestamp — or a repeat of an identical weight, where HA updates only `last_reported` — are silently discarded. The integration once reported `history_count: 4` while Postgres held 3 rows.
