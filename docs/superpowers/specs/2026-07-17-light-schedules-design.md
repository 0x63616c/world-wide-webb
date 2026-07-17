# Light Schedules — Design

**Date:** 2026-07-17
**Product:** control-center
**Status:** approved (brainstorm), pre-implementation

## Goal

User-editable schedules that drive the managed lights at times of day, on chosen
days of week, with an optional slow fade. Concretely, the two motivating cases:

1. **30 min before sunrise, every day** — turn on the non-bedroom lights.
2. **21:30 every day** — transition the (selected) lights to red, optionally over
   a long fade (e.g. 1 hour) from whatever state they're in.

This is built as a **general scheduling engine for lights** (not two hardcoded
rules). Future non-light schedule kinds are out of scope but the model should not
actively preclude them.

## Constraints / invariants honored

- **DB-authoritative** — schedules write *desired* light state into the existing
  `device_state` rows; the existing 1 s `light-enforcer` does all real HA calls.
  The scheduler NEVER calls Home Assistant directly. This is the same model
  lamp scenes / party mode already use.
- **Manual override wins for free** — if the user taps the panel mid-fade or after
  a schedule fires, `desiredState` changes; the enforcer follows it, and the
  scheduler detects "desired no longer matches what I last wrote" and aborts its
  in-progress fade. No schedule re-fires until its next scheduled event.
- No fake data. Storybook-first for the new tile. Structured logging in worker.
- Fixed 1366×1024 panel; tile placement in `tile-registry.ts`.
- IDs `sched_<id>`.

## Data model

New table `light_schedules` (migration `0011`). One row per schedule.

```
light_schedules
  id            text pk            -- sched_<nanoid>
  name          text notnull       -- "Sunrise on", "Red night"
  enabled       boolean notnull default true
  days          jsonb notnull      -- number[] 0..6 (0=Sun); [0..6] = every day
  trigger       jsonb notnull      -- ScheduleTrigger (see below)
  action        jsonb notnull      -- ScheduleAction (see below)
  target_ids    jsonb notnull      -- string[] of LIGHTS[].id
  last_fired_date text             -- YYYY-MM-DD of the last day this fired (edge-trigger guard)
  created_at_utc timestamptz notnull default now()
  updated_at_utc timestamptz notnull default now()
```

Types (authoritative shape + Zod live in `services/schedule-service.ts`, mirroring
the settings-service singleton pattern — jsonb columns typed structurally in
`schema.ts`):

```ts
type ScheduleTrigger =
  | { type: "fixed"; time: string }            // "HH:MM" local wall-clock
  | { type: "sun"; event: "sunrise" | "sunset"; offsetMin: number }; // ±minutes

interface ScheduleAction {
  on: boolean;                                 // false = turn off (color/brightness ignored)
  scene?: LampScene;                           // white | mood | red | blue (v1 = curated scenes, reuses lamp-scenes.ts)
  brightness?: number;                         // 0..100, optional
  fadeMinutes?: number;                        // 0/undefined = snap; >0 = ramp over N minutes
}
```

v1 color = the existing curated **LampScene** palette (white/mood/red/blue), for
consistency with the controls modal and because `red` already exists. Arbitrary
RGB/kelvin is a later extension (the action shape leaves room).

## Trigger time resolution

For a given local day, resolve the trigger to a wall-clock `Date`:

- `fixed` → today at `HH:MM`.
- `sun` → read the latest `weather_daily_reading` row for today, take
  `sunriseIso`/`sunsetIso` (already ingested every 5 min), parse as local
  wall-clock (reuse the `isoLocalToDate` approach from `weather-service.ts`),
  apply `offsetMin`. If no sun data for today, the schedule is skipped for the day
  and a warning is logged (no fake time invented).

## Execution engine — new `schedule-runner` worker

New worker loop in `worker/src/index.ts`, cadence **~15 s** (tight enough that a
fire is at most ~15 s late; cheap because the decision is pure + one indexed
read). Runs `runScheduleRunnerCycle` exported from `@control-center/api/worker`.

Cycle steps:

1. Load enabled schedules + today's sun times.
2. **Pure decision** `decideScheduleFires(now, schedules, sunTimes)` →
   `FireDecision[]`. A schedule fires when: `enabled`, today's weekday ∈ `days`,
   `resolvedTime <= now`, and `last_fired_date !== today` (edge-trigger: fires
   once per day when the clock crosses the trigger, not every tick after). Pure
   and RNG-free → fully unit-testable (same style as `partyColorsAtTick`).
3. For each firing schedule: compute target desired states and either
   - **snap** (`fadeMinutes` falsy): write final desired state to each target's
     `device_state` row, set `last_fired_date = today`.
   - **fade** (`fadeMinutes > 0`): register an in-memory fade ramp (start = each
     target's current desired, end = action target, duration = fadeMinutes),
     mark `last_fired_date = today` immediately (so it doesn't re-fire), and step
     the ramp on subsequent ticks.
4. **Fade stepping** (in-process, like the party engine): on each tick advance any
   active fades. For each target, interpolate brightness + color between start and
   end by elapsed/duration, write the interpolated desired state. **Abort guard:**
   before writing, compare the target's current `desiredState` to the value this
   fade last wrote; if they differ, the user (or another schedule) changed it —
   drop that target from the fade (manual override wins). Fades live in worker
   memory only; a worker restart cancels in-flight fades (acceptable — next day's
   fire re-runs; final snap-to-target could be added later if needed).

Colors interpolate in RGB; a scene resolves to its RGB (or kelvin→approx) up front
so the fade has concrete endpoints. Off-as-target with fade = ramp brightness to 0.

## API — `schedules` tRPC router

`trpc/routers/schedules.ts`, `schedule-service.ts` for logic. Procedures:

- `list` → all schedules (ordered by name).
- `create` / `update` — Zod-validated (`scheduleSchema`), `update` is a patch by id.
- `remove` — delete by id.
- `setEnabled` — toggle.
- `nextRuns` (query) — computed next fire time per schedule, for the tile "next up"
  line. Server-side (reuses the resolver so web has no sun math).

## Web — new **Schedules tile**

- Register in `tile-registry.ts` (new world-cell coords, ownsTap).
- **Tile view** (`SchedulesTileView.tsx`): compact — count of enabled schedules +
  the single next upcoming event (`nextRuns` min), e.g. "Red night · 21:30".
- **Expanded modal** (`ExpandedSchedulesModalView.tsx`): list of schedules with
  enable toggles; tap a row → **editor form**:
  - name
  - day chips (Mon–Sun, plus an "Every day" shortcut)
  - trigger: segmented `Fixed | Sunrise | Sunset`; fixed → time input; sun →
    `offsetMin` stepper ("30 min before / after")
  - target lights: multi-select from `LIGHTS` (grouped by room; a "Non-bedroom"
    quick-select convenience)
  - action: on/off; scene picker (white/mood/red/blue); brightness slider; fade
    minutes stepper
  - save / delete
- Build with shared `ui/` primitives; **Storybook stories first** for tile view,
  modal list, and editor (empty + populated states).

## Testing & proof-of-works (respecting "don't actuate real lights")

The user is asleep during build; **proof must NOT change real light colors.**

- **Unit** (bun test, api): `decideScheduleFires` truth table (weekday match,
  edge-trigger once/day, sun resolution with offset, disabled skip, missing sun
  data skip); fade interpolation (endpoints, midpoint, abort-on-drift); trigger
  resolver.
- **Integration** (against DB, no HA): seed a schedule, run the cycle with an
  injected `now`, assert the correct `device_state.desiredState` rows were written
  — this exercises the whole path *up to but not including* HA. The light-enforcer
  is a separate worker; not running it (or pointing at a scratch entity set) means
  no real bulb changes.
- **Deploy proof:** ship to prod (homelab), then verify via **worker logs** that
  `schedule-runner` registered and is computing next-fire times, and via
  `schedules.nextRuns` that the resolver returns sane times — **all schedules
  seeded disabled** so nothing fires on the real lights overnight. Real end-to-end
  actuation gets a deliberate opt-in test with the user awake.

## Files (new/changed)

- `api/src/db/schema.ts` — `lightSchedules` table + types.
- `api/src/db/migrations/0011_add_light_schedules.sql`.
- `api/src/services/schedule-service.ts` — Zod schema, CRUD, trigger resolver,
  `decideScheduleFires`, fade math (pure helpers exported for tests).
- `api/src/services/schedule-runner-service.ts` — `runScheduleRunnerCycle` + fade
  engine (in-process state), mirroring party-service.
- `api/src/trpc/routers/schedules.ts` + register in the app router.
- `api/src/worker.ts` barrel — export `runScheduleRunnerCycle`.
- `worker/src/index.ts` — register `schedule-runner` worker (~15 s).
- `web/src/components/tiles/SchedulesTile.tsx` + `SchedulesTileView.tsx` +
  `modals/ExpandedSchedulesModalView.tsx` + editor + stories.
- `web/src/lib/tile-registry.ts` — register tile.
- Docs: update `CODEBASE_OVERVIEW.md` scheduling note.

## Out of scope (v1)

- Arbitrary RGB/kelvin color picker (scenes only).
- Non-light schedule kinds.
- Fade persistence across worker restart.
- Per-schedule "only if already on" (spec'd action = force to target for all
  selected lights, per user).
