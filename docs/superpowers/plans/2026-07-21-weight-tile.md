# Weight Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renpho scale weight tracking end-to-end: HA BLE sensor → worker ingest → Postgres → tRPC → board tile + full-screen detail pages.

**Architecture:** Raw append-only `weight_measurement` rows ingested by a 60s worker cycle from the HA sensor; pure domain helpers (median, sanity band, summaries) in their own module; `weight` tRPC router; presentational TileView/Page components (storybook-first) wired live via the tile-detail registry with two variants (Trend, Readings).

**Tech Stack:** Bun, Drizzle/Postgres, tRPC, React, Storybook, existing `ha` client (`products/control-center/api/src/integrations/homeassistant`).

**Spec:** `docs/superpowers/specs/2026-07-21-weight-tile-design.md` — read it first.

## Global Constraints

- kg canonical in DB; lb display-only (`const LB_PER_KG = 2.2046226218`).
- Sanity band: |reading − 14-day rolling median (included rows)| > 5.4 kg (12 lb) → auto-exclude.
- Daily display value = median of the day's included measurements.
- IDs `wm_<16-hex>` (pattern: `booth-photo-service.ts:108`).
- No fake data at app runtime; fixtures only in `*.stories.tsx`.
- Full-screen pages, never modals (AGENTS.md).
- Structured logging in backend (pino via `getLogger()` patterns already in services).
- After registry/tile placement changes run the placeholder-tiles test.
- `bunx biome format --write products/control-center/api/src/db/migrations/meta` before committing a generated migration (lint gate).
- Commit + push after every task.

## Manual prerequisite (Calum or cmux browser, not a code task)

HA: HACS custom repo `ronnnnnnnnnnnnn/renpho_fitness_scale_ble` installed; Bluetooth scanner (active) enabled on the Shelly 1 Mini Gen4 near the bathroom; step on scale once; note the weight sensor entity id (expected like `sensor.renpho_..._weight`). Set env `HA_WEIGHT_ENTITY_ID` in infra if it differs from the default.

---

### Task 1: Schema + migration

**Files:**
- Modify: `products/control-center/api/src/db/schema.ts` (append after `boothPhoto` region)
- Generate: `products/control-center/api/src/db/migrations/*` via drizzle-kit

**Interfaces:**
- Produces: `weightMeasurement` Drizzle table export.

- [ ] **Step 1: Add table to schema.ts**

```ts
// Renpho scale weigh-ins (spec: docs/superpowers/specs/2026-07-21-weight-tile-design.md).
// Raw and append-only: every HA sensor update becomes a row; nothing is ever
// deleted or collapsed. Display-layer reduces to a daily median and hides rows
// with excluded_reason set (auto sanity-band or manual toggle from the panel).
export const weightMeasurement = pgTable(
  "weight_measurement",
  {
    id: text("id").primaryKey(), // wm_<16-hex>
    // The HA sensor's last_updated for this reading. Unique = ingest idempotency
    // (the 60s poll re-sees the same state until the next weigh-in).
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().unique(),
    // Canonical metric. lb is presentation-only.
    weightKg: doublePrecision("weight_kg").notNull(),
    // Body composition as reported (fat/muscle/water/BMR...); stored, not shown.
    bodyMetrics: jsonb("body_metrics"),
    source: text("source").notNull(), // 'ha_ble'
    // Non-null = hidden from all reads. 'sanity_band' (auto) | 'manual'.
    excludedReason: text("excluded_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("weight_measurement_measured_at_idx").on(t.measuredAt)],
);
```

Add `doublePrecision` and `jsonb` to the existing `drizzle-orm/pg-core` import if absent.

- [ ] **Step 2: Generate migration**

Run (from `products/control-center/api`): `bun run db:generate`
Expected: new `NNNN_*.sql` + meta update under `src/db/migrations`.

- [ ] **Step 3: Format meta + typecheck**

Run: `bunx biome format --write src/db/migrations/meta && cd ../../.. && bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add products/control-center/api/src/db
git commit -m "feat(cc/api): weight_measurement table"
git push
```

---

### Task 2: Pure weight domain helpers (TDD)

**Files:**
- Create: `products/control-center/api/src/services/weight-domain.ts`
- Test: `products/control-center/api/src/services/weight-domain.test.ts`

**Interfaces:**
- Produces:
  - `median(xs: number[]): number`
  - `isOutsideSanityBand(kg: number, recentIncludedKg: number[]): boolean` — true when ≥3 prior included readings exist and |kg − median| > `SANITY_BAND_KG` (5.4)
  - `dailyMedians(rows: { measuredAt: Date; weightKg: number }[]): { day: string; kg: number }[]` — day = local `YYYY-MM-DD`, input pre-filtered to included rows, output day-ascending
  - `summarize(daily: { day: string; kg: number }[]): { low: number; high: number; average: number; change: number } | null` — null on empty; change = last − first

- [ ] **Step 1: Write failing tests** (whole file; mirrors house vitest style — plain `describe/it/expect` from `vitest`)

```ts
import { describe, expect, it } from "vitest";
import { dailyMedians, isOutsideSanityBand, median, summarize } from "./weight-domain";

describe("median", () => {
  it("odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("isOutsideSanityBand", () => {
  const recent = [81.6, 81.8, 82.0, 82.2];
  it("passes normal readings", () => {
    expect(isOutsideSanityBand(81.0, recent)).toBe(false);
  });
  it("flags a guest 15kg away", () => {
    expect(isOutsideSanityBand(97.0, recent)).toBe(true);
  });
  it("inactive with fewer than 3 prior readings", () => {
    expect(isOutsideSanityBand(97.0, [81.6, 81.8])).toBe(false);
  });
});

describe("dailyMedians", () => {
  it("reduces same-day multiples to the median and sorts by day", () => {
    const rows = [
      { measuredAt: new Date("2026-07-16T07:41:00Z"), weightKg: 82.2 },
      { measuredAt: new Date("2026-07-16T07:44:00Z"), weightKg: 82.0 },
      { measuredAt: new Date("2026-07-15T07:19:00Z"), weightKg: 81.9 },
    ];
    expect(dailyMedians(rows)).toEqual([
      { day: "2026-07-15", kg: 81.9 },
      { day: "2026-07-16", kg: 82.1 },
    ]);
  });
});

describe("summarize", () => {
  it("low/high/average/change over the window", () => {
    const s = summarize([
      { day: "2026-07-15", kg: 82.0 },
      { day: "2026-07-16", kg: 81.0 },
      { day: "2026-07-17", kg: 81.5 },
    ]);
    expect(s).toEqual({ low: 81.0, high: 82.0, average: 81.5, change: -0.5 });
  });
  it("null on empty", () => {
    expect(summarize([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `bunx vitest run src/services/weight-domain.test.ts` (from api dir). Expected: module not found.

- [ ] **Step 3: Implement**

```ts
/** Pure weight math , no DB, no HA. Spec: 2026-07-21-weight-tile-design.md. */

export const SANITY_BAND_KG = 5.4; // 12 lb
export const LB_PER_KG = 2.2046226218;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Band is inactive until 3 included readings exist (first-days bootstrap). */
export function isOutsideSanityBand(kg: number, recentIncludedKg: number[]): boolean {
  if (recentIncludedKg.length < 3) return false;
  return Math.abs(kg - median(recentIncludedKg)) > SANITY_BAND_KG;
}

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
    byDay.get(day)?.push(r.weightKg) ?? byDay.set(day, [r.weightKg]);
  }
  return [...byDay.entries()]
    .map(([day, kgs]) => ({ day, kg: median(kgs) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function summarize(
  daily: { day: string; kg: number }[],
): { low: number; high: number; average: number; change: number } | null {
  if (daily.length === 0) return null;
  const kgs = daily.map((d) => d.kg);
  return {
    low: Math.min(...kgs),
    high: Math.max(...kgs),
    average: kgs.reduce((a, b) => a + b, 0) / kgs.length,
    change: kgs[kgs.length - 1] - kgs[0],
  };
}
```

Note: dailyMedians uses server-local day. Server TZ = house TZ on homelab; acceptable per spec simplicity.

- [ ] **Step 4: Run tests** — expected PASS. Also `bun run typecheck` at repo root.

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/services/weight-domain.ts products/control-center/api/src/services/weight-domain.test.ts
git commit -m "feat(cc/api): weight domain helpers"
git push
```

---

### Task 3: Ingest service + worker cycle

**Files:**
- Create: `products/control-center/api/src/services/weight-service.ts`
- Modify: `products/control-center/worker/src/index.ts` (workers array)
- Modify: api env module (where `HA_WEIGHT_ENTITY_ID` lands — follow how existing optional HA env vars are declared, e.g. near other `HA_*` vars)

**Interfaces:**
- Consumes: `ha.getEntity(entityId)` (`integrations/homeassistant`), `weightMeasurement` (Task 1), `isOutsideSanityBand` (Task 2).
- Produces: `runWeightIngestCycle(): Promise<void>` for the worker; `newWeightId()` internal.

- [ ] **Step 1: Implement service**

```ts
/**
 * Weight ingest , polls the HA Renpho BLE weight sensor and appends new
 * measurements. Idempotent via the measured_at unique index: the sensor state
 * is unchanged between weigh-ins, so most cycles insert nothing.
 */
import { desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { weightMeasurement } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import { getLogger } from "../logging"; // match the import used by sibling services
import { isOutsideSanityBand, LB_PER_KG } from "./weight-domain";

const ENTITY_ID = process.env.HA_WEIGHT_ENTITY_ID ?? "sensor.renpho_scale_weight";

function newWeightId(): string {
  return `wm_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function runWeightIngestCycle(): Promise<void> {
  const log = getLogger().child({ svc: "weight-ingest" });
  const entity = await ha.getEntity(ENTITY_ID);
  const kgRaw = Number.parseFloat(entity.state);
  if (!Number.isFinite(kgRaw)) return; // 'unknown'/'unavailable' between boots

  const unit = (entity.attributes.unit_of_measurement as string | undefined) ?? "kg";
  const weightKg = unit === "lb" ? kgRaw / LB_PER_KG : kgRaw;
  const measuredAt = new Date(entity.last_updated as string);

  // 14-day included history for the sanity band.
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ weightKg: weightMeasurement.weightKg })
    .from(weightMeasurement)
    .where(isNull(weightMeasurement.excludedReason))
    .where(gte(weightMeasurement.measuredAt, cutoff));
  const excluded = isOutsideSanityBand(weightKg, recent.map((r) => r.weightKg));

  const inserted = await db
    .insert(weightMeasurement)
    .values({
      id: newWeightId(),
      measuredAt,
      weightKg,
      bodyMetrics: null,
      source: "ha_ble",
      excludedReason: excluded ? "sanity_band" : null,
    })
    .onConflictDoNothing({ target: weightMeasurement.measuredAt })
    .returning({ id: weightMeasurement.id });
  if (inserted.length > 0) {
    log.info({ weightKg, measuredAt, excluded }, "weight measurement ingested");
  }
}
```

Adjust the two `.where()` chained calls into a single `and(...)` (drizzle requires it): `where(and(isNull(...), gte(...)))`. Verify the exact logger import against a sibling service (e.g. `weather` ingest) before writing.

- [ ] **Step 2: Register worker cycle** in `products/control-center/worker/src/index.ts` workers array:

```ts
  {
    // Renpho weight ingest (spec 2026-07-21): HA sensor → weight_measurement.
    name: "weight-ingest",
    intervalMs: 60_000,
    runOnStart: true,
    run: runWeightIngestCycle,
  },
```

Import alongside the other `@control-center/api` worker imports (match how `runWeatherIngestCycle` is imported).

- [ ] **Step 3: Typecheck + existing tests** — `bun run typecheck` and api vitest suite for touched files. HA errors: cycle throws → worker harness already logs/retries next tick (same contract as weather-ingest); no extra handling.

- [ ] **Step 4: Commit**

```bash
git add products/control-center/api/src/services/weight-service.ts products/control-center/worker/src/index.ts <env file if touched>
git commit -m "feat(cc): weight ingest cycle from HA BLE sensor"
git push
```

---

### Task 4: weight tRPC router

**Files:**
- Create: `products/control-center/api/src/trpc/routers/weight.ts`
- Modify: `products/control-center/api/src/trpc/routers/index.ts` (add `weight: weightRouter`)

**Interfaces:**
- Consumes: Task 1 table, Task 2 helpers.
- Produces (client shapes the web tasks rely on):
  - `weight.summary({ range: "7d" | "30d" | "all" })` → `{ latestKg: number; latestAt: string; daily: { day: string; kg: number }[]; low: number; high: number; average: number; change: number } | null` (null until first included reading)
  - `weight.readings()` → `{ id: string; measuredAt: string; weightKg: number; excludedReason: string | null; deltaKg: number | null }[]` newest-first; `deltaKg` vs previous **included** reading
  - `weight.setExcluded({ id, excluded })` → `{ ok: true }`; excluded true ⇒ `excluded_reason = 'manual'`, false ⇒ null

- [ ] **Step 1: Implement router**

```ts
import { z } from "zod";
import { desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../../db";
import { weightMeasurement } from "../../db/schema";
import { dailyMedians, summarize } from "../../services/weight-domain";
import { publicProcedure, router } from "../init";

const RANGE_DAYS = { "7d": 7, "30d": 30, all: null } as const;

export const weightRouter = router({
  summary: publicProcedure
    .input(z.object({ range: z.enum(["7d", "30d", "all"]) }))
    .query(async ({ input }) => {
      const days = RANGE_DAYS[input.range];
      const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
      const rows = await db
        .select({ measuredAt: weightMeasurement.measuredAt, weightKg: weightMeasurement.weightKg })
        .from(weightMeasurement)
        .where(
          cutoff
            ? and(isNull(weightMeasurement.excludedReason), gte(weightMeasurement.measuredAt, cutoff))
            : isNull(weightMeasurement.excludedReason),
        )
        .orderBy(weightMeasurement.measuredAt);
      if (rows.length === 0) return null;
      const daily = dailyMedians(rows);
      const s = summarize(daily);
      if (!s) return null;
      const latest = rows[rows.length - 1];
      return {
        latestKg: latest.weightKg,
        latestAt: latest.measuredAt.toISOString(),
        daily,
        ...s,
      };
    }),

  readings: publicProcedure.query(async () => {
    const rows = await db
      .select()
      .from(weightMeasurement)
      .orderBy(desc(weightMeasurement.measuredAt));
    // delta vs previous included reading (rows are newest-first; walk from the end)
    let prevIncluded: number | null = null;
    const withDelta = [...rows]
      .reverse()
      .map((r) => {
        const deltaKg =
          r.excludedReason == null && prevIncluded != null ? r.weightKg - prevIncluded : null;
        if (r.excludedReason == null) prevIncluded = r.weightKg;
        return {
          id: r.id,
          measuredAt: r.measuredAt.toISOString(),
          weightKg: r.weightKg,
          excludedReason: r.excludedReason,
          deltaKg,
        };
      })
      .reverse();
    return withDelta;
  }),

  setExcluded: publicProcedure
    .input(z.object({ id: z.string(), excluded: z.boolean() }))
    .mutation(async ({ input }) => {
      await db
        .update(weightMeasurement)
        .set({ excludedReason: input.excluded ? "manual" : null })
        .where(eq(weightMeasurement.id, input.id));
      return { ok: true } as const;
    }),
});
```

(Import `and` from drizzle-orm. Match `publicProcedure` naming to what sibling routers actually use — check `weather.ts`.)

- [ ] **Step 2: Wire into root router** (`index.ts`): import + `weight: weightRouter,`.

- [ ] **Step 3: Typecheck** — root `bun run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add products/control-center/api/src/trpc/routers/weight.ts products/control-center/api/src/trpc/routers/index.ts
git commit -m "feat(cc/api): weight trpc router"
git push
```

---

### Task 5: Icon + WeightTileView + WeightTile + registry

**Files:**
- Modify: `products/control-center/web/src/components/Icon.tsx` (GLYPHS: `weight: Weight` from lucide-react)
- Create: `products/control-center/web/src/components/tiles/WeightTileView.tsx`
- Create: `products/control-center/web/src/components/tiles/WeightTileView.stories.tsx`
- Create: `products/control-center/web/src/components/tiles/WeightTile.tsx`
- Modify: `products/control-center/web/src/lib/tile-registry.ts` (entry `tile_weight`)
- Modify: `products/control-center/web/src/lib/hooks.ts` (`POLL.weight: 60 * 1000`)

**Interfaces:**
- Consumes: `weight.summary` (Task 4).
- Produces: `WeightTileViewProps = { status: TileStatus; lb?: number; recencyLabel?: string; deltaLb30?: number; spark?: number[] }` (spark = daily lb values, oldest→newest); `WeightTile` container; `formatRecency(latestAt: string, now: Date): string` exported from the view module ("Today" / "Yesterday" / "Jul 12").

Implementation is the approved concept `WeightConceptSparkline` (see `WeightTileConcepts.tsx` before Task 7 deletes it) made presentational:
- `defineTileMeta` stories: Loading, Error, Populated, Empty (populated w/o data → skeleton), delta-up (muted) and delta-down (accent) cases.
- Header: `<TileHeader icon="weight" title="Weight" right={<DeltaBadge …/>} />`; sparkline top; hero `xxx.x lb` + recency label bottom (lineHeight 1); round latest dot positioned outside the stretched svg.
- kg→lb once at the container boundary: `lb = kg * LB_PER_KG` (duplicate the constant locally in the view module; web must not import api runtime).
- Registry entry: `{ id: "tile_weight", label: "Weight", component: WeightTile, viewComponent: WeightTileView, worldCol: 33, worldRow: 22, cols: 3, rows: 2 }` — free spot above the home cluster next to Guest (rows 22-23 bento); adjust if the placeholder-tiles test rejects it.

- [ ] **Step 1: Stories first** (fixture args, play asserts like `WeatherNowView.stories.tsx`), watch them fail to compile without the view.
- [ ] **Step 2: Implement `WeightTileView` + `formatRecency` with unit test in the stories play or a small vitest colocated in `__tests__` following `tile-title-sync.test.tsx` conventions.**
- [ ] **Step 3: Implement `WeightTile`** (`useTileQuery(trpc.weight.summary.useQuery({ range: "30d" }, { refetchInterval: POLL.weight }))`; null data ⇒ skeleton status pass-through).
- [ ] **Step 4: Registry entry + POLL constant; run** `bunx vitest run src/lib/__tests__ src/components/__tests__ --project=unit` equivalent suites: registry guards, tile-title-sync, placeholder-tiles/bento test, Board tests.
- [ ] **Step 5: Typecheck + full web vitest; commit**

```bash
git add products/control-center/web/src
git commit -m "feat(cc/web): weight tile"
git push
```

---

### Task 6: Detail pages (Trend + Readings variants)

**Files:**
- Create: `products/control-center/web/src/components/tiles/WeightPageView.tsx` (Trend page body, presentational)
- Create: `products/control-center/web/src/components/tiles/WeightReadingsView.tsx` (Readings list body, presentational)
- Create: stories for both
- Create: `products/control-center/web/src/components/tiles/detail/wiring/weight.tsx`
- Modify: `products/control-center/web/src/components/tiles/detail/registry.ts` (add `weightDetailEntry`)

**Interfaces:**
- Consumes: `weight.summary`, `weight.readings`, `weight.setExcluded` (Task 4).
- Produces:
  - `WeightPageViewProps = { status: TileStatus; range: "7d" | "30d" | "all"; onRangeChange(r): void; lb?: number; daily?: { day: string; lb: number }[]; low?: number; high?: number; average?: number; change?: number; windowLabel?: string }`
  - `WeightReadingsViewProps = { status: TileStatus; readings?: { id: string; whenLabel: string; showDate: boolean; lb: number; deltaLb: number | null; excluded: boolean; auto: boolean }[]; onToggle(id: string, excluded: boolean): void }`
  - `weightDetailEntry: TileDetailPageEntry` — `{ kind: "page", tileId: "tile_weight", title: "Weight", defaultSlug: "trend", useVariants }` with variants `trend` ("Trend") and `readings` ("Readings"); the host's VariantSwitcher replaces the concept's "All readings ›" link.

Implementation is the approved concepts (`WeightConceptDetail`, `WeightConceptReadings`) made presentational, minus the page-owned back button/width chrome (host supplies PageHeader; entry uses default `chrome: "header"`, current weight top-right moves into the Trend body's first row since the host owns the header). Readings nit from review: date only on first row of a day (`showDate`), time-only on same-day repeats. AUTO-FLAGGED chip when `excluded && auto` (auto = `excludedReason === "sanity_band"`).

- [ ] **Step 1: Stories for both views** (Loading, Populated, Empty; Readings story includes a flagged row + same-day pair; play asserts on "AUTO-FLAGGED" and an Exclude button).
- [ ] **Step 2: Implement both views** (port concept JSX, props-driven, `Segmented` for range, stats via `Stat`).
- [ ] **Step 3: Wiring** — `useVariants` hook queries summary (state: range) + readings; `setExcluded` mutation with `utils.weight.readings.invalidate()` + `utils.weight.summary.invalidate()` onSuccess (check exact invalidate util pattern in an existing wiring file using mutations, e.g. controls).
- [ ] **Step 4: Register entry; run the registry completeness test** (`detail/__tests__`), full web suite, typecheck.
- [ ] **Step 5: Commit**

```bash
git add products/control-center/web/src
git commit -m "feat(cc/web): weight detail pages (trend + readings)"
git push
```

---

### Task 7: Delete concepts, docs, deploy checks

**Files:**
- Delete: `products/control-center/web/src/components/tiles/WeightTileConcepts.tsx`, `WeightTileConcepts.stories.tsx`
- Modify: `CODEBASE_OVERVIEW.md` (one paragraph: weight ingest + tile, mirroring how other tiles/services are listed)

- [ ] **Step 1: Delete concept files; typecheck + full web/api vitest + lint.**
- [ ] **Step 2: Update CODEBASE_OVERVIEW.md.**
- [ ] **Step 3: Commit + push** (`feat(cc): finalize weight tile; drop concepts`). Push deploys.
- [ ] **Step 4: Post-deploy verification** — after CI: `kubectl` psql on `control-center-1` (db `control_center`): `select count(*) from weight_measurement;` (0 until first weigh-in is fine); worker logs show `weight-ingest` cycles without errors; panel shows the tile skeleton. After Calum's first weigh-in: row appears, tile populates. Screenshot tile + both pages on the panel or storybook for the ticket trail.

---

## Self-review notes

- Spec coverage: schema (T1), band+median (T2), ingest+60s (T3), summary/readings/setExcluded (T4), tile+icon+registry (T5), pages incl. readings toggle + day-grouping nit (T6), concept cleanup + docs + verify (T7). HA-side install is manual prerequisite.
- Entity id uncertainty isolated in `HA_WEIGHT_ENTITY_ID` env with default.
- Body metrics ingest deliberately null for now (integration attribute names unverified); column exists so backfill can start later without migration — matches spec "stored but not displayed" ambition without inventing attribute names.
