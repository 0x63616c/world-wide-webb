# Light Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a user-editable, general light-scheduling engine for control-center: schedules fire on days-of-week at a fixed time or sunrise/sunset±offset, and drive selected lights (on/off, scene color, brightness) with an optional long fade.

**Architecture:** DB-authoritative, same model as lamp scenes/party. A new `light_schedules` table holds each schedule. A new `schedule-runner` worker (~15 s) resolves each schedule's fire time, edge-triggers once per day, and writes *desired* light state into the existing `device_state` rows — the existing 1 s `light-enforcer` does all real Home Assistant calls. Long fades ramp desired in-process (like the party engine) and self-abort when the user overrides. A `schedules` tRPC router + a new Schedules tile/modal/editor expose CRUD.

**Tech Stack:** Bun, TypeScript, tRPC, Drizzle ORM + Postgres, Zod, React + Vitest + Storybook.

## Global Constraints

- No fake/placeholder data. A missing sun time → skip the schedule for the day + warn; never invent a time.
- Backend uses structured logging (`@www/logger` `getLogger()` / `createLogger`).
- IDs are `sched_<id>` (prefix + id).
- The scheduler NEVER calls Home Assistant directly — it only writes `device_state.desiredState`; the light-enforcer actuates.
- Storybook-first for new UI; build with shared primitives from `web/src/components/ui/`.
- Fixed 1366×1024 panel; tile placement only via `web/src/lib/tile-registry.ts`.
- v1 colors = the existing `LampScene` palette (`white | mood | red | blue`) from `api/src/config/lamp-scenes.ts`. No arbitrary RGB picker.
- **Proof must not actuate real lights** (user asleep): prove via unit + integration tests and worker logs; any seeded prod schedule ships **disabled**.
- api tests run with `vitest run` (files in `api/src/__tests__/*.test.ts`). Typecheck: `bun run typecheck` (per package). Repo push needs `--no-verify` (pre-existing knip failure).

---

### Task 1: `light_schedules` schema + migration

**Files:**
- Modify: `products/control-center/api/src/db/schema.ts` (append after the `settings` table, ~line 256)
- Generate: `products/control-center/api/src/db/migrations/0011_*.sql` (+ `meta/_journal.json`, snapshot — via drizzle-kit)

**Interfaces:**
- Produces: table `lightSchedules`; types `ScheduleTrigger`, `ScheduleAction`, `LightScheduleValue` (row insert/select via `typeof lightSchedules.$inferSelect`).

- [ ] **Step 1: Add types + table to `schema.ts`**

Append:

```ts
// User-editable light schedules (www-sched). Each row is one schedule the
// schedule-runner worker fires: on the chosen weekdays, when the resolved trigger
// time passes, it writes desired light state onto the target device_state rows
// (the light-enforcer then actuates HA). Trigger/action are jsonb so the shape can
// grow (future non-light kinds) without a column migration; the authoritative Zod
// shape lives in services/schedule-service.ts. Modeled on the device_state /
// settings jsonb-payload pattern.
export type ScheduleTrigger =
  | { type: "fixed"; time: string } // "HH:MM" local wall-clock
  | { type: "sun"; event: "sunrise" | "sunset"; offsetMin: number };

export interface ScheduleAction {
  on: boolean; // false = turn targets off (scene/brightness ignored)
  scene?: "white" | "mood" | "red" | "blue"; // LampScene; omitted = keep existing color
  brightness?: number; // 0..100, optional
  fadeMinutes?: number; // 0/undefined = snap; >0 = ramp over N minutes
}

export const lightSchedules = pgTable(
  "light_schedules",
  {
    id: text("id").primaryKey(), // sched_<id>
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    days: jsonb("days").$type<number[]>().notNull(), // 0..6 (0=Sun)
    trigger: jsonb("trigger").$type<ScheduleTrigger>().notNull(),
    action: jsonb("action").$type<ScheduleAction>().notNull(),
    targetIds: jsonb("target_ids").$type<string[]>().notNull(), // LIGHTS[].id
    lastFiredDate: text("last_fired_date"), // YYYY-MM-DD guard: fires once/day
    createdAtUtc: timestamp("created_at_utc", { withTimezone: true }).notNull().defaultNow(),
    updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("light_schedules_enabled_idx").on(t.enabled)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `cd products/control-center/api && bunx drizzle-kit generate --name add_light_schedules`
Expected: creates `src/db/migrations/0011_add_light_schedules.sql` containing `CREATE TABLE IF NOT EXISTS "light_schedules"`, appends an idx-11 entry to `meta/_journal.json`, writes a snapshot. Open the SQL and confirm it only creates the new table (no drops).

- [ ] **Step 3: Typecheck**

Run: `cd products/control-center/api && bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add products/control-center/api/src/db/schema.ts products/control-center/api/src/db/migrations
git commit -m "feat(control-center): light_schedules table + migration"
```

---

### Task 2: Schedule Zod schema + trigger resolver (pure)

**Files:**
- Create: `products/control-center/api/src/services/schedule-service.ts`
- Test: `products/control-center/api/src/__tests__/schedule-resolver.test.ts`

**Interfaces:**
- Consumes: `ScheduleTrigger`, `ScheduleAction` from `db/schema`; `isoLocalToDate`-style parse (reimplemented locally, see below).
- Produces:
  - `scheduleTriggerSchema`, `scheduleActionSchema`, `scheduleInputSchema` (Zod)
  - `type SunTimes = { sunriseIso: string | null; sunsetIso: string | null }`
  - `resolveTriggerTime(trigger: ScheduleTrigger, dayStart: Date, sun: SunTimes): Date | null` — the wall-clock fire time for the local day containing `dayStart` (midnight), or `null` when a sun trigger has no sun data.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveTriggerTime } from "../services/schedule-service";

const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0);

describe("resolveTriggerTime", () => {
  it("resolves a fixed HH:MM to that wall-clock time on the day", () => {
    const t = resolveTriggerTime({ type: "fixed", time: "21:30" }, midnight(2026, 7, 17), {
      sunriseIso: null,
      sunsetIso: null,
    });
    expect(t).toEqual(new Date(2026, 6, 17, 21, 30, 0));
  });

  it("resolves sunrise minus 30 min from the day's sunrise ISO", () => {
    const t = resolveTriggerTime(
      { type: "sun", event: "sunrise", offsetMin: -30 },
      midnight(2026, 7, 17),
      { sunriseIso: "2026-07-17T05:50", sunsetIso: "2026-07-17T20:40" },
    );
    expect(t).toEqual(new Date(2026, 6, 17, 5, 20, 0));
  });

  it("returns null when a sun trigger has no sun data", () => {
    const t = resolveTriggerTime(
      { type: "sun", event: "sunset", offsetMin: 0 },
      midnight(2026, 7, 17),
      { sunriseIso: null, sunsetIso: null },
    );
    expect(t).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-resolver.test.ts`
Expected: FAIL ("resolveTriggerTime is not a function" / module not found).

- [ ] **Step 3: Write `schedule-service.ts` (schema + resolver)**

```ts
import { z } from "zod";
import type { ScheduleAction, ScheduleTrigger } from "../db/schema";

// ─── Zod shape (authoritative validation for the trpc router) ─────────────────
export const scheduleTriggerSchema = z.union([
  z.object({ type: z.literal("fixed"), time: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({
    type: z.literal("sun"),
    event: z.enum(["sunrise", "sunset"]),
    offsetMin: z.number().int().min(-720).max(720),
  }),
]);

export const scheduleActionSchema = z.object({
  on: z.boolean(),
  scene: z.enum(["white", "mood", "red", "blue"]).optional(),
  brightness: z.number().int().min(0).max(100).optional(),
  fadeMinutes: z.number().int().min(0).max(720).optional(),
});

export const scheduleInputSchema = z.object({
  name: z.string().min(1).max(60),
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).min(1),
  trigger: scheduleTriggerSchema,
  action: scheduleActionSchema,
  targetIds: z.array(z.string()).min(1),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export interface SunTimes {
  sunriseIso: string | null;
  sunsetIso: string | null;
}

/** Parse "2026-07-17T05:50" as local wall-clock (no tz). Null on malformed input. */
function isoLocalToDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
}

/**
 * The wall-clock fire time for the local day containing `dayStart` (that day's
 * midnight). Fixed → that day at HH:MM. Sun → the day's sunrise/sunset ISO +
 * offsetMin. Returns null when a sun trigger has no data for the day (caller skips
 * it — never invent a time).
 */
export function resolveTriggerTime(
  trigger: ScheduleTrigger,
  dayStart: Date,
  sun: SunTimes,
): Date | null {
  if (trigger.type === "fixed") {
    const [h, min] = trigger.time.split(":").map(Number);
    return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), h, min, 0);
  }
  const iso = trigger.event === "sunrise" ? sun.sunriseIso : sun.sunsetIso;
  if (!iso) return null;
  const base = isoLocalToDate(iso);
  if (!base) return null;
  return new Date(base.getTime() + trigger.offsetMin * 60_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-resolver.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/services/schedule-service.ts products/control-center/api/src/__tests__/schedule-resolver.test.ts
git commit -m "feat(control-center): schedule zod schema + trigger resolver"
```

---

### Task 3: `decideScheduleFires` (pure edge-trigger decision)

**Files:**
- Modify: `products/control-center/api/src/services/schedule-service.ts`
- Test: `products/control-center/api/src/__tests__/schedule-decide.test.ts`

**Interfaces:**
- Consumes: `resolveTriggerTime`, `SunTimes`; a minimal `ScheduleRow` view.
- Produces:
  - `interface ScheduleRow { id: string; enabled: boolean; days: number[]; trigger: ScheduleTrigger; lastFiredDate: string | null }`
  - `localDateKey(d: Date): string` → "YYYY-MM-DD"
  - `decideScheduleFires(now: Date, schedules: ScheduleRow[], sun: SunTimes): string[]` → ids that should fire now.

A schedule fires when: `enabled`, `now`'s weekday ∈ `days`, resolved time ≤ `now`, and `lastFiredDate !== localDateKey(now)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { decideScheduleFires, type ScheduleRow } from "../services/schedule-service";

const sun = { sunriseIso: "2026-07-17T05:50", sunsetIso: "2026-07-17T20:40" };
// 2026-07-17 is a Friday (weekday 5).
const at = (h: number, m: number) => new Date(2026, 6, 17, h, m, 0);

const base: ScheduleRow = {
  id: "sched_a",
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  trigger: { type: "fixed", time: "21:30" },
  lastFiredDate: null,
};

describe("decideScheduleFires", () => {
  it("fires once the clock passes the trigger", () => {
    expect(decideScheduleFires(at(21, 30), [base], sun)).toEqual(["sched_a"]);
  });
  it("does not fire before the trigger time", () => {
    expect(decideScheduleFires(at(21, 29), [base], sun)).toEqual([]);
  });
  it("does not re-fire once lastFiredDate is today", () => {
    const fired = { ...base, lastFiredDate: "2026-07-17" };
    expect(decideScheduleFires(at(22, 0), [fired], sun)).toEqual([]);
  });
  it("skips a disabled schedule", () => {
    expect(decideScheduleFires(at(22, 0), [{ ...base, enabled: false }], sun)).toEqual([]);
  });
  it("skips when today's weekday is not selected (Fri=5)", () => {
    expect(decideScheduleFires(at(22, 0), [{ ...base, days: [0, 6] }], sun)).toEqual([]);
  });
  it("skips a sun trigger with no sun data (no invented time)", () => {
    const s: ScheduleRow = { ...base, trigger: { type: "sun", event: "sunrise", offsetMin: -30 } };
    expect(decideScheduleFires(at(23, 0), [s], { sunriseIso: null, sunsetIso: null })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-decide.test.ts`
Expected: FAIL ("decideScheduleFires is not a function").

- [ ] **Step 3: Add to `schedule-service.ts`**

```ts
export interface ScheduleRow {
  id: string;
  enabled: boolean;
  days: number[];
  trigger: ScheduleTrigger;
  lastFiredDate: string | null;
}

/** Local "YYYY-MM-DD" for a Date (used as the once-per-day fire guard). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Pure edge-trigger decision: which schedule ids should fire at `now`. A schedule
 * fires when enabled, today's weekday is selected, its resolved trigger time has
 * passed, and it hasn't already fired today (lastFiredDate guard). RNG-free →
 * fully testable, mirrors partyColorsAtTick.
 */
export function decideScheduleFires(now: Date, schedules: ScheduleRow[], sun: SunTimes): string[] {
  const today = localDateKey(now);
  const weekday = now.getDay();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const out: string[] = [];
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (!s.days.includes(weekday)) continue;
    if (s.lastFiredDate === today) continue;
    const fireAt = resolveTriggerTime(s.trigger, dayStart, sun);
    if (!fireAt) continue;
    if (now.getTime() >= fireAt.getTime()) out.push(s.id);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-decide.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/services/schedule-service.ts products/control-center/api/src/__tests__/schedule-decide.test.ts
git commit -m "feat(control-center): decideScheduleFires edge-trigger decision"
```

---

### Task 4: Fade interpolation (pure)

**Files:**
- Create: `products/control-center/api/src/services/schedule-fade.ts`
- Test: `products/control-center/api/src/__tests__/schedule-fade.test.ts`

**Interfaces:**
- Consumes: `DeviceLightState`, `LightColor` from `db/schema`.
- Produces:
  - `interface FadeEndpoint { on: boolean; brightnessRaw?: number; rgb?: [number, number, number]; kelvin?: number }`
  - `interpolateLight(start: FadeEndpoint, end: FadeEndpoint, t: number): DeviceLightState` — `t` clamped 0..1; brightness + rgb lerp'd and rounded; kelvin lerp'd; `on` follows `end` (off target ramps brightness→0 but reports `on: end.on`).

Brightness is HA raw 0..255 (matches `DeviceLightState.brightness`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { interpolateLight, type FadeEndpoint } from "../services/schedule-fade";

const white: FadeEndpoint = { on: true, brightnessRaw: 0, kelvin: 4000 };
const red: FadeEndpoint = { on: true, brightnessRaw: 255, rgb: [255, 0, 0] };

describe("interpolateLight", () => {
  it("returns the start at t=0", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 100, rgb: [0, 0, 0] };
    const e: FadeEndpoint = { on: true, brightnessRaw: 200, rgb: [255, 255, 255] };
    expect(interpolateLight(s, e, 0)).toEqual({ on: true, brightness: 100, color: { rgb: [0, 0, 0] } });
  });
  it("returns the end at t=1", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 0, rgb: [0, 0, 0] };
    expect(interpolateLight(s, red, 1)).toEqual({ on: true, brightness: 255, color: { rgb: [255, 0, 0] } });
  });
  it("lerps rgb + brightness at the midpoint", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 0, rgb: [0, 0, 0] };
    expect(interpolateLight(s, red, 0.5)).toEqual({ on: true, brightness: 128, color: { rgb: [128, 0, 0] } });
  });
  it("clamps t below 0 and above 1", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 0, rgb: [0, 0, 0] };
    expect(interpolateLight(s, red, -1)).toEqual(interpolateLight(s, red, 0));
    expect(interpolateLight(s, red, 2)).toEqual(interpolateLight(s, red, 1));
  });
  it("ramps brightness toward 0 for an off target but keeps on:false", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 200, rgb: [255, 0, 0] };
    const off: FadeEndpoint = { on: false, brightnessRaw: 0, rgb: [255, 0, 0] };
    expect(interpolateLight(s, off, 1)).toEqual({ on: false, brightness: 0, color: { rgb: [255, 0, 0] } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-fade.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `schedule-fade.ts`**

```ts
import type { DeviceLightState, LightColor } from "../db/schema";

export interface FadeEndpoint {
  on: boolean;
  brightnessRaw?: number; // HA raw 0..255
  rgb?: [number, number, number];
  kelvin?: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/**
 * Interpolate a light between two endpoints at fraction `t` (clamped 0..1).
 * Brightness (raw 0..255) and rgb are lerp'd componentwise; kelvin is lerp'd when
 * both endpoints carry it. `on` always follows the END endpoint — an off target
 * ramps brightness toward 0 while reporting on:false so the enforcer turns it off
 * once the ramp completes. Color prefers rgb when the end has rgb, else kelvin.
 */
export function interpolateLight(start: FadeEndpoint, end: FadeEndpoint, t: number): DeviceLightState {
  const f = clamp01(t);
  const state: DeviceLightState = { on: end.on };
  const sb = start.brightnessRaw ?? 0;
  const eb = end.brightnessRaw ?? 0;
  state.brightness = lerp(sb, eb, f);

  let color: LightColor | undefined;
  if (end.rgb) {
    const sr = start.rgb ?? end.rgb;
    color = { rgb: [lerp(sr[0], end.rgb[0], f), lerp(sr[1], end.rgb[1], f), lerp(sr[2], end.rgb[2], f)] };
  } else if (end.kelvin != null) {
    const sk = start.kelvin ?? end.kelvin;
    color = { kelvin: lerp(sk, end.kelvin, f) };
  }
  if (color) state.color = color;
  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-fade.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/services/schedule-fade.ts products/control-center/api/src/__tests__/schedule-fade.test.ts
git commit -m "feat(control-center): light fade interpolation"
```

---

### Task 5: Action → per-target endpoints (scene resolution)

**Files:**
- Modify: `products/control-center/api/src/services/schedule-fade.ts`
- Test: `products/control-center/api/src/__tests__/schedule-action.test.ts`

**Interfaces:**
- Consumes: `ScheduleAction` from `db/schema`; `RED_RGB`, `BLUE_RGB`, `WHITE_SCENE_KELVIN`, `assignMoodColors` from `config/lamp-scenes`.
- Produces: `actionEndpoints(action: ScheduleAction, targetEntityIds: string[]): Map<string, FadeEndpoint>` — resolves the action to a concrete per-entity endpoint (mood → a distinct palette color per target; white → kelvin; red/blue → rgb; no scene → color left undefined so the fade keeps existing color; brightness → raw; off → on:false).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { actionEndpoints } from "../services/schedule-fade";
import { RED_RGB, WHITE_SCENE_KELVIN } from "../config/lamp-scenes";

describe("actionEndpoints", () => {
  it("maps a red scene to an rgb endpoint per target, on + brightness", () => {
    const eps = actionEndpoints({ on: true, scene: "red", brightness: 80 }, ["a", "b"]);
    expect(eps.get("a")).toEqual({ on: true, rgb: [...RED_RGB], brightnessRaw: Math.round((80 / 100) * 255) });
    expect(eps.get("b")).toEqual({ on: true, rgb: [...RED_RGB], brightnessRaw: Math.round((80 / 100) * 255) });
  });
  it("maps a white scene to a kelvin endpoint", () => {
    const eps = actionEndpoints({ on: true, scene: "white" }, ["a"]);
    expect(eps.get("a")).toEqual({ on: true, kelvin: WHITE_SCENE_KELVIN });
  });
  it("gives each target a DISTINCT mood color", () => {
    const eps = actionEndpoints({ on: true, scene: "mood" }, ["a", "b", "c"]);
    const keys = ["a", "b", "c"].map((k) => JSON.stringify(eps.get(k)!.rgb));
    expect(new Set(keys).size).toBe(3);
  });
  it("off action yields on:false endpoints", () => {
    const eps = actionEndpoints({ on: false }, ["a"]);
    expect(eps.get("a")).toEqual({ on: false });
  });
  it("no scene leaves color unset (keep existing)", () => {
    const eps = actionEndpoints({ on: true, brightness: 50 }, ["a"]);
    const ep = eps.get("a")!;
    expect(ep.rgb).toBeUndefined();
    expect(ep.kelvin).toBeUndefined();
    expect(ep.on).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-action.test.ts`
Expected: FAIL ("actionEndpoints is not a function").

- [ ] **Step 3: Add `actionEndpoints` to `schedule-fade.ts`**

```ts
import type { ScheduleAction } from "../db/schema";
import { assignMoodColors, BLUE_RGB, RED_RGB, WHITE_SCENE_KELVIN } from "../config/lamp-scenes";

/**
 * Resolve a ScheduleAction to a concrete FadeEndpoint per target entity. Off →
 * { on:false }. On: brightness (0..100→raw) applies to every target; scene sets the
 * color endpoint — white=kelvin, red/blue=rgb (uniform), mood=a DISTINCT random
 * palette color per target (endpoints fixed up front so a fade has stable ends). No
 * scene → color left unset so a fade keeps each light's existing color.
 */
export function actionEndpoints(
  action: ScheduleAction,
  targetEntityIds: string[],
): Map<string, FadeEndpoint> {
  const out = new Map<string, FadeEndpoint>();
  if (!action.on) {
    for (const id of targetEntityIds) out.set(id, { on: false });
    return out;
  }
  const brightnessRaw =
    action.brightness != null ? Math.round((Math.min(100, Math.max(0, action.brightness)) / 100) * 255) : undefined;
  const mood = action.scene === "mood" ? assignMoodColors(targetEntityIds.length) : null;
  targetEntityIds.forEach((id, i) => {
    const ep: FadeEndpoint = { on: true };
    if (brightnessRaw != null) ep.brightnessRaw = brightnessRaw;
    if (action.scene === "white") ep.kelvin = WHITE_SCENE_KELVIN;
    else if (action.scene === "red") ep.rgb = [...RED_RGB];
    else if (action.scene === "blue") ep.rgb = [...BLUE_RGB];
    else if (action.scene === "mood" && mood) ep.rgb = [...mood[i]];
    out.set(id, ep);
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-action.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/services/schedule-fade.ts products/control-center/api/src/__tests__/schedule-action.test.ts
git commit -m "feat(control-center): resolve schedule action to per-target endpoints"
```

---

### Task 6: Schedule store (CRUD against DB)

**Files:**
- Modify: `products/control-center/api/src/services/schedule-service.ts`
- Test: `products/control-center/api/src/__tests__/schedule-store.test.ts` (uses a mocked `db`, following the existing service-test pattern — see `sonos-volume-enforcer-service.test.ts` for the mock style)

**Interfaces:**
- Consumes: `db` from `db/index`, `lightSchedules` from `db/schema`, `scheduleInputSchema`.
- Produces:
  - `listSchedules(): Promise<Schedule[]>` where `Schedule = typeof lightSchedules.$inferSelect`
  - `createSchedule(input: ScheduleInput): Promise<Schedule>` (id = `sched_` + nanoid)
  - `updateSchedule(id: string, patch: Partial<ScheduleInput>): Promise<Schedule>`
  - `deleteSchedule(id: string): Promise<void>`
  - `setScheduleEnabled(id: string, enabled: boolean): Promise<Schedule>`

- [ ] **Step 1: Write the failing test (id shape + validation)**

Focus the unit test on the pure, DB-independent surface: id generation format and that `createSchedule` rejects invalid input via the Zod schema. (Full DB round-trips are covered by the integration test in Task 8.)

```ts
import { describe, expect, it } from "vitest";
import { newScheduleId } from "../services/schedule-service";

describe("newScheduleId", () => {
  it("prefixes ids with sched_", () => {
    expect(newScheduleId()).toMatch(/^sched_[A-Za-z0-9_-]+$/);
  });
  it("is unique across calls", () => {
    expect(newScheduleId()).not.toBe(newScheduleId());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-store.test.ts`
Expected: FAIL ("newScheduleId is not a function").

- [ ] **Step 3: Add CRUD + id helper to `schedule-service.ts`**

Check how ids are generated elsewhere first: `grep -rn "nanoid\|createId\|randomUUID" products/control-center/api/src | head`. Use the same generator the codebase already uses. If nanoid is present:

```ts
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getLogger } from "@www/logger";
import { db } from "../db/index";
import { lightSchedules } from "../db/schema";

export type Schedule = typeof lightSchedules.$inferSelect;

/** New schedule id, prefix + short random (repo IDs default to prefix_<id>). */
export function newScheduleId(): string {
  return `sched_${nanoid(10)}`;
}

export async function listSchedules(): Promise<Schedule[]> {
  return db.select().from(lightSchedules).orderBy(lightSchedules.name);
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const value = scheduleInputSchema.parse(input);
  const now = new Date();
  const [row] = await db
    .insert(lightSchedules)
    .values({ id: newScheduleId(), ...value, createdAtUtc: now, updatedAtUtc: now })
    .returning();
  getLogger().info({ id: row.id, name: row.name }, "schedule created");
  return row;
}

export async function updateSchedule(id: string, patch: Partial<ScheduleInput>): Promise<Schedule> {
  const value = scheduleInputSchema.partial().parse(patch);
  const [row] = await db
    .update(lightSchedules)
    .set({ ...value, updatedAtUtc: new Date() })
    .where(eq(lightSchedules.id, id))
    .returning();
  return row;
}

export async function deleteSchedule(id: string): Promise<void> {
  await db.delete(lightSchedules).where(eq(lightSchedules.id, id));
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<Schedule> {
  const [row] = await db
    .update(lightSchedules)
    .set({ enabled, updatedAtUtc: new Date() })
    .where(eq(lightSchedules.id, id))
    .returning();
  return row;
}
```

(If the codebase uses a different id generator than `nanoid`, swap the import + call accordingly; keep `newScheduleId` returning `sched_<id>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd products/control-center/api && bun run typecheck
git add products/control-center/api/src/services/schedule-service.ts products/control-center/api/src/__tests__/schedule-store.test.ts
git commit -m "feat(control-center): light schedule CRUD store"
```

---

### Task 7: Runner cycle + desired-write + fade engine

**Files:**
- Create: `products/control-center/api/src/services/schedule-runner-service.ts`
- Modify: `products/control-center/api/src/worker-deps.ts` (export the cycle)
- Test: `products/control-center/api/src/__tests__/schedule-runner.test.ts` (pure fade-state helper only; the DB path is exercised in Task 8's integration test)

**Interfaces:**
- Consumes: `decideScheduleFires`, `resolveTriggerTime`, `localDateKey`, `SunTimes` (schedule-service); `actionEndpoints`, `interpolateLight`, `FadeEndpoint` (schedule-fade); `findLight`, `LightKind` (config/lights); `db`, `deviceState`, `lightSchedules`, `DeviceLightState` (db); `getLogger`.
- Produces:
  - `runScheduleRunnerCycle(): Promise<void>` — one tick: load enabled schedules + today's sun, decide fires, start fades / snap, step active fades, write desired.
  - Pure helper `fadeProgress(startMs: number, nowMs: number, fadeMinutes: number): number` → 0..1 fraction (nowMs-startMs)/(fadeMinutes*60000), clamped; `fadeMinutes<=0` → 1.

Fade state is module-level in-memory: `Map<string /*entityId*/, { start: FadeEndpoint; end: FadeEndpoint; startedMs: number; fadeMinutes: number; lastWritten: DeviceLightState }>`. Abort guard: before each step, if the entity's current `device_state.desiredState` ≠ the fade's `lastWritten`, drop that entity from the fade (manual override wins).

- [ ] **Step 1: Write the failing test (pure fadeProgress)**

```ts
import { describe, expect, it } from "vitest";
import { fadeProgress } from "../services/schedule-runner-service";

describe("fadeProgress", () => {
  it("is 0 at start", () => expect(fadeProgress(1000, 1000, 60)).toBe(0));
  it("is 0.5 halfway through a 60-min fade", () =>
    expect(fadeProgress(0, 30 * 60_000, 60)).toBe(0.5));
  it("clamps to 1 past the end", () =>
    expect(fadeProgress(0, 120 * 60_000, 60)).toBe(1));
  it("snaps (returns 1) when fadeMinutes<=0", () =>
    expect(fadeProgress(0, 0, 0)).toBe(1));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-runner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `schedule-runner-service.ts`**

```ts
import { getLogger } from "@www/logger";
import { eq, inArray } from "drizzle-orm";
import { findLight, LightKind } from "../config/lights";
import { db } from "../db/index";
import type { DeviceLightState } from "../db/schema";
import { deviceState, lightSchedules, weatherDailyReading } from "../db/schema";
import { DeviceKind } from "./device-state-mapping";
import { actionEndpoints, type FadeEndpoint, interpolateLight } from "./schedule-fade";
import {
  decideScheduleFires,
  localDateKey,
  type ScheduleRow,
  type SunTimes,
} from "./schedule-service";

const COMMAND_WINDOW_MS = 10_000; // mirror controls-service: enforcer pushes desired within this window.

interface Fade {
  end: FadeEndpoint;
  start: FadeEndpoint;
  startedMs: number;
  fadeMinutes: number;
  lastWritten: DeviceLightState | null;
}

// entityId → active fade. Module-level so it survives across ticks (worker restart
// clears it, acceptable — next day's fire re-runs). Snap actions are just a fade
// with fadeMinutes 0 that completes on its first step.
const activeFades = new Map<string, Fade>();

/** Fraction 0..1 of a fade elapsed. fadeMinutes<=0 → 1 (snap). */
export function fadeProgress(startedMs: number, nowMs: number, fadeMinutes: number): number {
  if (fadeMinutes <= 0) return 1;
  const frac = (nowMs - startedMs) / (fadeMinutes * 60_000);
  return Math.min(1, Math.max(0, frac));
}

/** Today's sun times from the latest weather_daily_reading row for today. */
async function todaySun(today: string): Promise<SunTimes> {
  try {
    const rows = await db
      .select({ sunriseIso: weatherDailyReading.sunriseIso, sunsetIso: weatherDailyReading.sunsetIso })
      .from(weatherDailyReading)
      .where(eq(weatherDailyReading.targetDate, today))
      .orderBy(weatherDailyReading.recordedAt);
    const latest = rows[rows.length - 1];
    return { sunriseIso: latest?.sunriseIso ?? null, sunsetIso: latest?.sunsetIso ?? null };
  } catch {
    return { sunriseIso: null, sunsetIso: null };
  }
}

/** Read the current desired state for a set of entity ids. */
async function currentDesired(entityIds: string[]): Promise<Map<string, DeviceLightState | null>> {
  const rows = await db.select().from(deviceState).where(inArray(deviceState.entityId, entityIds));
  return new Map(rows.map((r) => [r.entityId, (r.desiredState as DeviceLightState | null) ?? null]));
}

/** Build a FadeEndpoint from an existing desired state (fade start point). */
function endpointFromDesired(s: DeviceLightState | null): FadeEndpoint {
  return {
    on: s?.on ?? false,
    brightnessRaw: s?.brightness,
    rgb: s?.color?.rgb,
    kelvin: s?.color?.kelvin,
  };
}

/** Write desired for one entity (+ command window) so the enforcer actuates it. */
async function writeDesired(entityId: string, desired: DeviceLightState): Promise<void> {
  const light = findLight(entityId);
  if (!light) return;
  const now = new Date();
  const desiredUntil = new Date(now.getTime() + COMMAND_WINDOW_MS);
  await db
    .insert(deviceState)
    .values({
      id: light.id,
      kind: light.kind === LightKind.Lamp ? DeviceKind.Light : DeviceKind.Switch,
      entityId: light.entityId,
      domain: light.domain,
      label: light.label,
      desiredState: desired,
      desiredAtUtc: now,
      desiredUntilUtc: desiredUntil,
      available: true,
    })
    .onConflictDoUpdate({
      target: deviceState.entityId,
      set: { desiredState: desired, desiredAtUtc: now, desiredUntilUtc: desiredUntil },
    });
}

/**
 * One scheduler tick. Loads enabled schedules + today's sun, fires any whose
 * trigger just passed (edge-triggered once/day via lastFiredDate), registers a
 * fade per target (snap = fadeMinutes 0), then steps every active fade, writing
 * interpolated desired state. Manual override aborts a fade: if a target's current
 * desired no longer equals what the fade last wrote, the fade drops that target.
 * The scheduler NEVER calls HA — the light-enforcer actuates the desired writes.
 */
export async function runScheduleRunnerCycle(): Promise<void> {
  const log = getLogger();
  const now = new Date();
  const today = localDateKey(now);

  let schedules: (typeof lightSchedules.$inferSelect)[] = [];
  try {
    schedules = await db.select().from(lightSchedules).where(eq(lightSchedules.enabled, true));
  } catch (err) {
    log.warn({ err }, "schedule-runner: load failed");
    return;
  }
  const sun = await todaySun(today);

  const rows: ScheduleRow[] = schedules.map((s) => ({
    id: s.id,
    enabled: s.enabled,
    days: s.days,
    trigger: s.trigger,
    lastFiredDate: s.lastFiredDate,
  }));
  const firing = new Set(decideScheduleFires(now, rows, sun));

  // Start fades for firing schedules, and stamp lastFiredDate so they fire once/day.
  for (const s of schedules) {
    if (!firing.has(s.id)) continue;
    const targetEntityIds = s.targetIds
      .map((id) => findLight(id))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => l.entityId);
    if (targetEntityIds.length === 0) continue;
    const ends = actionEndpoints(s.action, targetEntityIds);
    const starts = await currentDesired(targetEntityIds);
    for (const entityId of targetEntityIds) {
      const end = ends.get(entityId);
      if (!end) continue;
      activeFades.set(entityId, {
        end,
        start: endpointFromDesired(starts.get(entityId) ?? null),
        startedMs: now.getTime(),
        fadeMinutes: s.action.fadeMinutes ?? 0,
        lastWritten: null,
      });
    }
    try {
      await db.update(lightSchedules).set({ lastFiredDate: today }).where(eq(lightSchedules.id, s.id));
    } catch (err) {
      log.warn({ err, id: s.id }, "schedule-runner: lastFiredDate stamp failed");
    }
    log.info({ id: s.id, name: s.name, targets: targetEntityIds.length }, "schedule fired");
  }

  // Step every active fade.
  if (activeFades.size > 0) {
    const ids = [...activeFades.keys()];
    const desiredNow = await currentDesired(ids);
    for (const entityId of ids) {
      const fade = activeFades.get(entityId)!;
      // Abort guard: user (or another schedule) changed desired out from under us.
      const cur = desiredNow.get(entityId) ?? null;
      if (fade.lastWritten && JSON.stringify(cur) !== JSON.stringify(fade.lastWritten)) {
        activeFades.delete(entityId);
        log.info({ entityId }, "schedule fade aborted (manual override)");
        continue;
      }
      const t = fadeProgress(fade.startedMs, now.getTime(), fade.fadeMinutes);
      const desired = interpolateLight(fade.start, fade.end, t);
      try {
        await writeDesired(entityId, desired);
        fade.lastWritten = desired;
      } catch (err) {
        log.warn({ err, entityId }, "schedule-runner: desired write failed");
      }
      if (t >= 1) activeFades.delete(entityId); // fade complete (snap completes immediately)
    }
  }
}
```

- [ ] **Step 4: Export the cycle from the worker barrel**

In `products/control-center/api/src/worker-deps.ts` add (alphabetical, next to the other `run*` exports):

```ts
export { runScheduleRunnerCycle } from "./services/schedule-runner-service";
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-runner.test.ts && bun run typecheck`
Expected: PASS (4 tests) + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add products/control-center/api/src/services/schedule-runner-service.ts products/control-center/api/src/worker-deps.ts products/control-center/api/src/__tests__/schedule-runner.test.ts
git commit -m "feat(control-center): schedule-runner cycle + in-process fade engine"
```

---

### Task 8: Integration test — full cycle writes desired (no HA)

**Files:**
- Test: `products/control-center/api/src/__tests__/schedule-runner-integration.test.ts`

This proves the whole path up to (not including) HA: seed a schedule, run the cycle, assert `device_state.desiredState` was written — without any light-enforcer running, so no real bulb changes.

**Interfaces:**
- Consumes: everything above. Uses the same DB-mock approach the other `__tests__` service tests use (a stubbed `db` from `../db/index`). Follow the existing mock pattern in `sonos-volume-enforcer-service.test.ts`; if that test mocks `../db/index` with `vi.mock`, mirror it: an in-memory schedules array + a captured `deviceState` upsert.

- [ ] **Step 1: Write the test**

Model it exactly on the existing enforcer service test's mock harness. The test:
1. `vi.mock("../db/index")` returning a fake `db` whose `select().from(lightSchedules)` yields one enabled fixed-time schedule whose trigger time is just before `now`, and whose `deviceState` upsert is captured into an array.
2. Freeze `now` by passing a schedule with `time` set to one minute before a fixed wall-clock the test controls (or inject via a `vi.useFakeTimers()`/`setSystemTime` call — check what the repo's other time-based tests use; `weather-read-service.test.ts` is a reference).
3. Call `runScheduleRunnerCycle()`.
4. Assert: a `deviceState` upsert was captured for each target entity id with `desiredState.on === true` and (for a red scene) `desiredState.color.rgb` = `[255,0,0]`; and `lightSchedules` got a `lastFiredDate` update.

Write concrete assertions (no placeholders) once the mock shape is copied from the reference test. Keep it to a single `it("fires a due schedule and writes desired for each target, no HA call")`.

- [ ] **Step 2: Run it to verify it passes**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/schedule-runner-integration.test.ts`
Expected: PASS. If the DB mock is awkward, fall back to asserting via the exported pure pieces already covered — but prefer the real cycle.

- [ ] **Step 3: Run the whole api suite + typecheck**

Run: `cd products/control-center/api && bun run test && bun run typecheck`
Expected: PASS (all existing + new tests green).

- [ ] **Step 4: Commit**

```bash
git add products/control-center/api/src/__tests__/schedule-runner-integration.test.ts
git commit -m "test(control-center): schedule-runner writes desired end-to-end (no HA)"
```

---

### Task 9: `schedules` tRPC router

**Files:**
- Create: `products/control-center/api/src/trpc/routers/schedules.ts`
- Modify: `products/control-center/api/src/trpc/routers/index.ts` (register)

**Interfaces:**
- Consumes: `schedule-service` CRUD + `scheduleInputSchema`; `resolveTriggerTime`, `localDateKey` for `nextRuns`; `todaySun` is private — recompute sun inline in the router from `weatherDailyReading` (or export a `getTodaySun()` from schedule-service; do that).
- Produces: `schedulesRouter` with `list`, `create`, `update`, `remove`, `setEnabled`, `nextRuns`.

- [ ] **Step 1: Export `getTodaySun` from schedule-service**

Add to `schedule-service.ts` (so both runner and router share it — DRY):

```ts
import { eq } from "drizzle-orm";
import { weatherDailyReading } from "../db/schema";

/** Today's sun times from the latest weather_daily_reading row (null when absent). */
export async function getTodaySun(today: string): Promise<SunTimes> {
  try {
    const rows = await db
      .select({ sunriseIso: weatherDailyReading.sunriseIso, sunsetIso: weatherDailyReading.sunsetIso })
      .from(weatherDailyReading)
      .where(eq(weatherDailyReading.targetDate, today))
      .orderBy(weatherDailyReading.recordedAt);
    const latest = rows[rows.length - 1];
    return { sunriseIso: latest?.sunriseIso ?? null, sunsetIso: latest?.sunsetIso ?? null };
  } catch {
    return { sunriseIso: null, sunsetIso: null };
  }
}
```

Then in `schedule-runner-service.ts` replace the private `todaySun` with `getTodaySun` imported from schedule-service (delete the local copy). Re-run Task 7's test to confirm still green.

- [ ] **Step 2: Write the router**

```ts
import { z } from "zod";
import {
  createSchedule,
  deleteSchedule,
  getTodaySun,
  listSchedules,
  localDateKey,
  resolveTriggerTime,
  scheduleInputSchema,
  setScheduleEnabled,
  updateSchedule,
} from "../../services/schedule-service";
import { publicProcedure, router } from "../init";

export const schedulesRouter = router({
  list: publicProcedure.query(() => listSchedules()),

  create: publicProcedure.input(scheduleInputSchema).mutation(({ input }) => createSchedule(input)),

  update: publicProcedure
    .input(z.object({ id: z.string(), patch: scheduleInputSchema.partial() }))
    .mutation(({ input }) => updateSchedule(input.id, input.patch)),

  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deleteSchedule(input.id);
      return { ok: true };
    }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => setScheduleEnabled(input.id, input.enabled)),

  // Next upcoming fire time per schedule, for the tile "next up" line. Computed
  // server-side so the web has no sun math. ISO string or null (no sun data).
  nextRuns: publicProcedure.query(async () => {
    const now = new Date();
    const sun = await getTodaySun(localDateKey(now));
    const schedules = await listSchedules();
    return schedules.map((s) => {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const t = resolveTriggerTime(s.trigger, dayStart, sun);
      return { id: s.id, nextIso: t ? t.toISOString() : null };
    });
  }),
});
```

- [ ] **Step 3: Register in `index.ts`**

Add `import { schedulesRouter } from "./schedules";` and `schedules: schedulesRouter,` in the `appRouter` object.

- [ ] **Step 4: Typecheck**

Run: `cd products/control-center/api && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/trpc/routers/schedules.ts products/control-center/api/src/trpc/routers/index.ts products/control-center/api/src/services/schedule-service.ts products/control-center/api/src/services/schedule-runner-service.ts
git commit -m "feat(control-center): schedules tRPC router + shared getTodaySun"
```

---

### Task 10: Register the `schedule-runner` worker

**Files:**
- Modify: `products/control-center/worker/src/index.ts`

**Interfaces:**
- Consumes: `runScheduleRunnerCycle` from `@control-center/api/worker`.

- [ ] **Step 1: Add the import**

In the `@control-center/api/worker` import block, add `runScheduleRunnerCycle,` (alphabetical).

- [ ] **Step 2: Register the worker**

Add to the `workers` array (after `party-mode`):

```ts
  {
    // Light schedules (www-sched): every ~15s, fires due schedules and steps any
    // in-progress fades, writing DESIRED light state. The light-enforcer actuates
    // HA — this loop never calls HA itself. 15s keeps a fire at most ~15s late.
    name: "schedule-runner",
    intervalMs: 15_000,
    runOnStart: true,
    run: runScheduleRunnerCycle,
  },
```

- [ ] **Step 3: Typecheck the worker**

Run: `cd products/control-center/worker && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add products/control-center/worker/src/index.ts
git commit -m "feat(control-center): register schedule-runner worker (~15s)"
```

---

### Task 11: Web — tRPC types + Schedules tile view (Storybook-first)

**Files:**
- Create: `products/control-center/web/src/components/tiles/SchedulesTileView.tsx`
- Create: `products/control-center/web/src/components/tiles/SchedulesTileView.stories.tsx`

**Interfaces:**
- Produces: `SchedulesTileView` (presentational — props only, no data fetching), showing enabled-schedule count + the single next upcoming event label. Mirror `ControlsTileView` prop-only structure.

- [ ] **Step 1: Look at the reference tile view + a stories file**

Read `web/src/components/tiles/ControlsTileView.tsx` and its `.stories.tsx` (if present) or another `*View.stories.tsx` for the exact `TileHeader`/`ui` primitive imports and the `BoardDecorator` story wrapper. Match them.

- [ ] **Step 2: Write the story first (empty + populated)**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { SchedulesTileView } from "./SchedulesTileView";

const meta: Meta<typeof SchedulesTileView> = { component: SchedulesTileView, title: "Tiles/Schedules" };
export default meta;
type Story = StoryObj<typeof SchedulesTileView>;

export const Empty: Story = { args: { enabledCount: 0, nextLabel: null } };
export const Populated: Story = { args: { enabledCount: 3, nextLabel: "Red night · 21:30" } };
```

- [ ] **Step 3: Implement `SchedulesTileView`**

Prop-only, using the shared `TileHeader` + `ui/` primitives exactly as `ControlsTileView` does. Props: `{ enabledCount: number; nextLabel: string | null }`. Body: header "Schedules"; a line "{enabledCount} active"; and the next-up label (or "No upcoming" when null). No fetching, no fake data.

- [ ] **Step 4: Verify in Storybook build**

Run: `cd products/control-center/web && bun run typecheck`
Expected: PASS. (Storybook visual check happens in Task 13.)

- [ ] **Step 5: Commit**

```bash
git add products/control-center/web/src/components/tiles/SchedulesTileView.tsx products/control-center/web/src/components/tiles/SchedulesTileView.stories.tsx
git commit -m "feat(control-center/web): Schedules tile view + stories"
```

---

### Task 12: Web — Schedules editor modal + container tile + registry

**Files:**
- Create: `products/control-center/web/src/components/tiles/modals/ExpandedSchedulesModalView.tsx`
- Create: `products/control-center/web/src/components/tiles/modals/ExpandedSchedulesModalView.stories.tsx`
- Create: `products/control-center/web/src/components/tiles/SchedulesTile.tsx` (data container: trpc `schedules.list` + `schedules.nextRuns`, renders `SchedulesTileView`, opens the modal)
- Modify: `products/control-center/web/src/lib/tile-registry.ts` (register)

**Interfaces:**
- Consumes: `SchedulesTileView`; trpc `schedules.*`; `LIGHTS` for the target multi-select (import the config, grouped by `room`).
- Produces: `SchedulesTile`, `SchedulesTileView` registry entry (`ownsTap: true`).

- [ ] **Step 1: Modal — list + editor (story first)**

Write `ExpandedSchedulesModalView.stories.tsx` with a populated list (2 schedules) and the editor open on one. The modal view is presentational: props = `{ schedules, nextRuns, onCreate, onUpdate, onDelete, onToggle }`. The editor form fields (using `ui/` primitives + `SettingsPanel` `Row`/`StackField` helpers as reference):
  - name (text)
  - day chips Mon–Sun + "Every day" shortcut (writes `days` 0..6)
  - trigger: segmented `Fixed | Sunrise | Sunset`; fixed → time `HH:MM`; sun → offset stepper (label "N min before/after")
  - targets: checklist from `LIGHTS` grouped by room, plus a "Non-bedroom" quick-select (selects every `LIGHTS` id whose `room !== "Bedroom"`)
  - action: on/off toggle; scene picker `white|mood|red|blue`; brightness slider 0..100; fade-minutes stepper
  - Save / Delete buttons

- [ ] **Step 2: Implement `ExpandedSchedulesModalView`**

Presentational only — all mutations via the `on*` callbacks. No fake data; empty list renders an explicit "No schedules yet" + a "New schedule" button. Follow the modal structure of `ExpandedControlsModalView.tsx`.

- [ ] **Step 3: Implement `SchedulesTile` container**

Fetch `schedules.list` + `schedules.nextRuns` via the web trpc client (match how `ControlsTile.tsx` calls trpc + its `refetchInterval`). Compute `enabledCount` and the min `nextIso` → `nextLabel` (format `HH:MM` + name). Wire the modal's `on*` callbacks to the trpc mutations with query invalidation (mirror `ControlsTile` optimistic/refetch pattern). Render `SchedulesTileView` + the modal.

- [ ] **Step 4: Register the tile**

In `tile-registry.ts`: add the two imports and a `TILE_REGISTRY` entry. Extend the `TileComponent`/`TileViewComponent` unions with `typeof SchedulesTile` / `typeof SchedulesTileView`. Placement: pick a free world cell adjacent to Controls (e.g. `worldCol: 38, worldRow: 30, cols: 4, rows: 3`), `ownsTap: true`, `label: "Schedules"`. Confirm the chosen rectangle doesn't overlap an existing entry's rectangle (scan the current entries' col/row/cols/rows).

- [ ] **Step 5: Typecheck**

Run: `cd products/control-center/web && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/control-center/web/src/components/tiles/modals/ExpandedSchedulesModalView.tsx products/control-center/web/src/components/tiles/modals/ExpandedSchedulesModalView.stories.tsx products/control-center/web/src/components/tiles/SchedulesTile.tsx products/control-center/web/src/lib/tile-registry.ts
git commit -m "feat(control-center/web): Schedules modal, editor, tile + registry"
```

---

### Task 13: Full verification, docs, ship, prove

**Files:**
- Modify: `CODEBASE_OVERVIEW.md` (add a Scheduling note)

- [ ] **Step 1: Repo-wide gates**

Run from repo root:
```bash
bun run typecheck && bun run test && bun run lint
```
Expected: all PASS. Fix anything red before shipping. (If `bun run knip` flags the new exports, ensure each is actually consumed; the pre-existing knip failure noted in CLAUDE.md is separate.)

- [ ] **Step 2: Storybook visual check**

Run the web Storybook and screenshot the `Tiles/Schedules` stories + the modal editor (use the browser tooling). Confirm the tile view and editor render with real props, no overflow on the 1366×1024 board. Attach/note the screenshots.

- [ ] **Step 3: Update `CODEBASE_OVERVIEW.md`**

Add a short "Light schedules" subsection: the `light_schedules` table, the `schedule-runner` worker (~15 s, DB-authoritative, never calls HA), the `schedules` tRPC router, and the Schedules tile.

- [ ] **Step 4: Commit docs**

```bash
git add CODEBASE_OVERVIEW.md
git commit -m "docs(control-center): document light schedules"
```

- [ ] **Step 5: Ship to prod**

Merge the branch to `main` and push (push triggers the product-aware CI/deploy). Per CLAUDE.md the push needs `--no-verify` (pre-existing knip failure):
```bash
git push --no-verify origin main   # or ff-merge the worktree branch into main first, then push
```
Watch CI/deploy for control-center api + worker + web images.

- [ ] **Step 6: Prove — WITHOUT actuating real lights**

The user is asleep; do not turn on/recolor real bulbs. Proof:
  1. **Migration applied:** confirm the worker/api boot logs show migrations ran, and `light_schedules` exists (query the prod DB: `select count(*) from light_schedules;`).
  2. **Worker registered:** confirm the worker startup log lists `schedule-runner` among `workers`, and per-cycle it logs no errors.
  3. **Resolver sane:** call `schedules.nextRuns` (via the API) and confirm it returns plausible ISO times for a seeded schedule.
  4. **Seed the two real schedules DISABLED:** create (via `schedules.create`) "Sunrise on" (sun/sunrise −30, non-bedroom targets, on, white) and "Red night" (fixed 21:30, chosen targets, red, fade 60) with `enabled: false`, so nothing fires overnight. Confirm they appear in `schedules.list` and on the tile.
  5. Leave a note for the user: to arm them, toggle enabled in the Schedules tile when awake; a live end-to-end actuation test should be done together.

- [ ] **Step 7: Report**

Summarize: tests green (counts), CI/deploy status, migration applied, worker registered, `nextRuns` output, and the two seeded-disabled schedules — with the explicit note that no real lights were changed.

---

## Notes for the executor

- Run each package's `typecheck`/`test` from that package dir; the repo-root `bun run test` runs all.
- Match existing DB-mock style in `api/src/__tests__` for the store + integration tests — don't invent a new harness.
- The web tile must reuse `ui/` primitives and `TileHeader`; do not hand-roll styled elements.
- Everything the scheduler does is a `device_state.desiredState` write — if you find yourself importing the HA client in scheduler code, stop: that's the enforcer's job.
