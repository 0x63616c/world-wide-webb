# Device Name in Logs — Design & Implementation Spec

Date: 2026-07-15
Status: Proposed (planning only — no code written)

## Overview

Every device (browser / iPad) running the Control Center dashboard must carry a
user-specified, per-device "Device name" (e.g. "iPhone", "iPad", "Calum's
Laptop"). The name is set in the existing settings modal, defaults to a
sensible on-device value, drives an un-dismissable red notification until the
user explicitly sets it, and is stamped onto every frontend log entry (existing
entries included) so the logs viewer can attribute each line to a device.

### The six requirements (restated)

1. **Per-device, not global.** Stored locally on the device, never shared across
   panels. localStorage is the fit (confirmed below).
2. **Sensible default.** If never set, derive a real, non-empty name on-device
   from `navigator.userAgent` / `navigator.platform`. The "user has not set one"
   state must remain independently detectable.
3. **Settings modal.** Add a labeled text input to
   `SettingsPanel.tsx` to set the name.
4. **Un-dismissable red notification.** Top-right of the dashboard, "Please set
   your device name in settings", shown until the user explicitly sets a name.
   No dismiss affordance.
5. **Logs tagged with device name.** Every frontend log entry carries the
   device name; the logs modal displays it.
6. **Existing saved logs migrated.** Already-stored logs are updated to carry a
   device name.

---

## Critical architecture finding (changes the shape of #5 and #6)

**Frontend logs are stored entirely on-device. There is no Postgres logs table
and no server-side log ingestion.** The pipeline is:

- Write API: `products/control-center/web/src/lib/log/logger.ts` — `write()` at
  `logger.ts:102` builds a `LogEntry`, pushes it into an in-memory ring
  (`LogRing`) and a flush queue.
- Durable store: `products/control-center/web/src/lib/log/store.ts` — IndexedDB
  database `cc-logs`, object store `entries`, keyed on `id` (`store.ts:35-146`).
- Native mirror: `products/control-center/web/src/lib/log/native.ts` — a JSONL
  file written through the Capacitor Filesystem bridge (`native.ts:119`), used to
  restore IndexedDB after WebKit ITP eviction.
- Wire shape: `products/control-center/web/src/lib/log/types.ts` — the `LogEntry`
  interface (`types.ts:22-47`).
- Viewer: `products/control-center/web/src/components/LogsModal.tsx` (rows at
  `LogsModal.tsx:444-487`) and the histogram tile
  `products/control-center/web/src/components/tiles/FrontendLogsTileView.tsx`.

Verification that nothing reaches the server: the tRPC router list
(`products/control-center/api/src/trpc/routers/`) has no `logs` router; a grep for
log ingestion in `products/control-center/api/src` finds only backend pino
logging, never a frontend-log sink. The DB schema
(`products/control-center/api/src/db/schema.ts`) has no logs table.

**Consequences:**

- Requirement #5 is purely a web-app change: add a field to `LogEntry`, stamp it
  in `write()`, render a column in `LogsModal`. No API router, no service, no
  worker.
- Requirement #6 is an **IndexedDB** migration (plus a native-mirror normalize),
  **not** a Drizzle/Postgres migration. The task brief assumed a Postgres logs
  table; that assumption is incorrect for this codebase. The Drizzle migration
  structure is documented below for completeness, but **no Drizzle migration is
  required for this feature.**

---

## Chosen approach per requirement

### 1 + 2. Per-device storage, sensible default, detectable "not set" state

Model device name in a new dependency-light singleton store,
`products/control-center/web/src/lib/device-name.ts`, mirroring the
`useSyncExternalStore` pattern already used by `lib/settings.ts` and
`lib/useNotifications.ts` (module-level state + listener set + hook). This gives
the settings input and the banner one live source of truth without prop
drilling.

**Why not the existing settings store?** `lib/settings.ts` is deliberately
**global**: every write goes through a server sink (`settings.ts:185-212`,
`registerServerSink`) and `useSettingsSync.ts` pushes it to
`trpc.settings.set`, syncing all wall panels to one config
(`useSettingsSync.ts:23-66`). Device name is explicitly per-device, so it must
**not** touch that store or the server sink. A separate local store keeps it off
the global sync path entirely.

**localStorage keys** (following the established `cc-*` convention, e.g.
`settings.ts:84-94`):

- `cc-device-name` — the **user-set** name. Absent until the user explicitly
  sets one. **Presence of this key (non-empty) is the sole "user has set a
  name" signal.**
- `cc-device-name-auto` — the derived default, persisted once so the logged /
  displayed name is stable across reloads even if UA parsing later changes.

**"Not set" detection (unambiguous):**

```
isDeviceNameSet()  ==  a non-empty string is stored under `cc-device-name`
```

The derived default living under a *different* key means the effective name is
never empty (req #2) while "user has not chosen one" stays independently true
(req #4). This is a **separate-key** design, not a sentinel value — chosen so we
never have to reserve a magic string that a user could legitimately type.

**Effective name used for logs + display:**

```
getDeviceName()  ==  cc-device-name (if non-empty)  else  cc-device-name-auto
                     (generating + persisting the auto default on first read)
```

**Default derivation** (`deriveDefaultName()`): a short, readable slug from
`navigator.userAgent` + `navigator.platform`, e.g. "iPad", "iPhone",
"Chrome-macOS", "Safari-iPadOS". Pure function, deterministic, unit-testable. If
UA is unavailable (SSR/tests), fall back to a fixed readable string like
`"unknown-device"`. This is a real value, never empty (satisfies "not fake data"
by being a genuine, honest derivation, not a placeholder pretending to be real
user input).

**Public surface of `device-name.ts`:**

- `deriveDefaultName(): string` (pure, exported for tests)
- `getDeviceName(): string` — effective name, cached in a module var, recomputed
  only on set (called on every log write, so must be cheap)
- `isDeviceNameSet(): boolean`
- `setDeviceName(name: string): void` — writes `cc-device-name`, updates cache,
  emits; empty/whitespace input clears the key (reverts to auto + re-shows
  banner)
- `useDeviceName(): { name: string; isSet: boolean }` — `useSyncExternalStore`
  hook

**Cycle avoidance:** `logger.ts` will `import { getDeviceName }` from
`device-name.ts`. Therefore `device-name.ts` MUST NOT statically import
`logger.ts` (that would form `logger → device-name → logger`). If we want to log
device-name changes (parity with `settings.ts:207`), do it via a lazy dynamic
import inside `setDeviceName`, or skip logging the change. Recommended: skip
static import; a lazy `import("./log/logger")` inside the setter is acceptable if
we want the audit line.

### 3. Settings modal

`products/control-center/web/src/components/SettingsPanel.tsx` already renders
grouped `Section`s reading `useSettings()` and calling module-level setters
(`SettingsPanel.tsx:119-244`). Add a new top `Section` titled **"Device"** with a
single full-width labeled field (reuse the existing `StackField` helper,
`SettingsPanel.tsx:91-113`) containing a text input bound to
`useDeviceName()` / `setDeviceName`.

**Text input primitive:** `products/control-center/web/src/components/ui/` has
no text-input primitive today (it has `Slider`, `Switch`, `Segmented`). Per the
"shared UI primitives" and "Storybook-first" invariants, add a small
`ui/TextInput.tsx` (label, value, onChange, placeholder) styled to match the
existing controls (see the search input styling in `LogsModal.tsx:289-307`), with
a `TextInput.stories.tsx`. The device field placeholder shows the derived default
so the user sees what the auto name currently is.

### 4. Un-dismissable red notification

The banner pattern is: a component raises into the shared `useNotifications`
store **and** renders its own absolutely-positioned view; there is no central
renderer. See `AppUpdateBanner.tsx` (raises id `"app-update"` at
`AppUpdateBanner.tsx:63`, renders `AppUpdateBannerView` top-right at
`top:62 / right:18 / zIndex:100`, `AppUpdateBanner.tsx:75-115`) and
`ConnectionLostBanner.tsx` (`top:18 / right:18 / zIndex:100`).

Both mount inside a fixed overlay in `Board.tsx`:
`<div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:200 }}>`
holding `<ConnectionLostBanner />` and `<AppUpdateBanner />`
(`Board.tsx:647-649`).

Create `products/control-center/web/src/components/DeviceNameBanner.tsx`:

- Reads `useDeviceName()`. When `!isSet`, `raiseNotification({ id:
  "device-name", message: "Please set your device name in settings" })`; when
  set, `clearNotification("device-name")`. Same effect pattern as
  `AppUpdateBanner.tsx:61-67`.
- Renders a **red** view (background/border/text using `--red`/`#e5484d`, the
  error color already used in `LogsModal.tsx:71`) positioned top-right. Stack it
  clear of the others (e.g. `top: 18, right: 18` and raise the app-update/
  connection offsets, or place the device banner at the top and shift the
  others down — pick offsets so all visible banners stack without overlap;
  final numbers to be tuned in Storybook).
- **No dismiss control** — there is intentionally no close button and no
  `clearNotification` path other than the name becoming set. This satisfies
  "cannot be dismissed — only disappears once the user sets a name."
- Export a presentational `DeviceNameBannerView` for Storybook (mirrors
  `AppUpdateBannerView`), plus `DeviceNameBanner.stories.tsx`.

Mount `<DeviceNameBanner />` in the `Board.tsx` overlay next to the other two
(`Board.tsx:647-649`).

### 5. Logs tagged with device name

- Add `deviceName: string` to `LogEntry` (`types.ts:22-47`), documented like the
  existing `sha` field (carried per-entry because a persisted store can span
  multiple devices' restored history and multiple name changes over time).
- Stamp it in `logger.ts` `write()` (`logger.ts:102-120`): read
  `getDeviceName()` and include `deviceName` on the entry. Cheap by design
  (cached module var).
- Display it in `LogsModal.tsx`: add a "Device" column to the shared `GRID`
  template (`LogsModal.tsx:62`), the header (`LogsModal.tsx:341-346`), and the
  `LogRow` cells (`LogsModal.tsx:476-484`). Optionally include `deviceName` in
  the search haystack in both `store.matches()` (`store.ts:302-319`) and the
  modal's in-memory filter (`LogsModal.tsx:222`) so "search by device" works.
- `FrontendLogsTileView.tsx` needs **no change** — it is a per-level histogram/
  tally only, with no per-entry rows.

### 6. Existing saved logs migrated

Existing entries live in (a) the IndexedDB `entries` store and (b) the native
JSONL mirror. Neither currently carries any device/client identifier — entries
have `id` (`${bootMs}-${seq}`), `sha`, `level`, `source`, `msg`, `data`
(`types.ts:22-47`), but **no device id to backfill from**. So old rows get a
**default**, and the sensible default here is *this device's resolved name*:
because the `cc-logs` store is itself per-device, every row already in it was
produced by this device, so stamping them with `getDeviceName()` is correct, not
a placeholder.

**What old rows get:** `deviceName = getDeviceName()` at migration time — i.e.
the user's name if they had already set one, otherwise the derived auto default.
If `getDeviceName()` is somehow unresolvable, use the literal `"unknown"`.

**IndexedDB migration (primary):** bump `DB_VERSION` 3 → 4 in `store.ts`
(`store.ts:41`) and change `onupgradeneeded` (`store.ts:119-141`) so the v3→v4
step **preserves and backfills** instead of dropping. Today the upgrade
unconditionally drops+rebuilds `entries` (`store.ts:128`, justified as "debug
logs, rebuilding costs nothing"). Requirement #6 explicitly requires existing
logs be *updated*, not lost, so for this version step we walk the existing store
with a cursor inside the versionchange transaction and `cursor.update({ ...value,
deviceName })` for any entry missing `deviceName`, where `deviceName =
getDeviceName()` (read synchronously from localStorage on the main thread — safe
inside `onupgradeneeded`). Fresh installs (no prior `entries` store) have nothing
to migrate.

**Native mirror normalize:** JSONL lines cannot be edited in place cheaply, and
restore only runs when IndexedDB came up empty (`native.ts:166-185`,
`restoreFromNative`). Normalize on restore: for each parsed entry, if
`deviceName` is absent set it to `getDeviceName()` before `append()`. Add this in
`native.ts` `parseLines`/`restoreFromNative` or in the `boot.ts` append callback
(`boot.ts` `restoreFromNative(..., append)`).

**Read-time safety net:** in `LogsModal` rendering, treat a missing `deviceName`
as `getDeviceName()` (or "unknown") so nothing renders blank even if a device
skipped the IDB migration (private mode / quota / degraded store). This makes the
display honest without depending on the migration having run.

**No Drizzle migration.** For completeness: Drizzle migrations live in
`products/control-center/api/src/db/migrations/` (numbered SQL, e.g.
`0010_yellow_grandmaster.sql`, meta in `migrations/meta/`), generated by
`bunx drizzle-kit generate` (`api/package.json:20`), applied at API/worker boot
via `products/control-center/api/src/db/migrate.ts`. None of this is touched by
this feature, because logs are not in Postgres.

---

## Concrete change list

### DB schema + migration
- **None.** No Postgres schema change, no Drizzle migration. (See finding above.)

### API router / service / worker
- **None.** Device name is per-device and never leaves the browser; logs never
  reach the API.

### Web — new files
- `products/control-center/web/src/lib/device-name.ts` — singleton store:
  `deriveDefaultName`, `getDeviceName`, `isDeviceNameSet`, `setDeviceName`,
  `useDeviceName`. localStorage keys `cc-device-name`, `cc-device-name-auto`.
  Must not statically import `logger.ts`.
- `products/control-center/web/src/components/DeviceNameBanner.tsx` +
  `DeviceNameBanner.stories.tsx` — red, un-dismissable, top-right; raises/clears
  notification id `"device-name"`.
- `products/control-center/web/src/components/ui/TextInput.tsx` +
  `TextInput.stories.tsx` — shared labeled text input primitive.
- Tests: `lib/__tests__/device-name.test.ts`,
  `components/__tests__/DeviceNameBanner.test.tsx`, and a store-migration test
  (see test plan).

### Web — edited files
- `products/control-center/web/src/lib/log/types.ts` — add `deviceName: string`
  to `LogEntry` (`types.ts:22-47`).
- `products/control-center/web/src/lib/log/logger.ts` — import `getDeviceName`;
  stamp `deviceName` in `write()` (`logger.ts:102-120`).
- `products/control-center/web/src/lib/log/store.ts` — `DB_VERSION` 3→4
  (`store.ts:41`); preserving+backfilling `onupgradeneeded` for v3→v4
  (`store.ts:119-141`); add `deviceName` to search haystack in `matches()`
  (`store.ts:302-319`).
- `products/control-center/web/src/lib/log/native.ts` — normalize missing
  `deviceName` on restore (`native.ts:133-185`).
- `products/control-center/web/src/components/LogsModal.tsx` — add "Device"
  column to `GRID` (`:62`), header (`:341-346`), `LogRow` (`:476-484`); add
  `deviceName` to the in-memory search filter (`:222`); read-time fallback for
  missing `deviceName`.
- `products/control-center/web/src/components/SettingsPanel.tsx` — new "Device"
  `Section` with a `TextInput` bound to `useDeviceName`/`setDeviceName`
  (`:119-244`).
- `products/control-center/web/src/components/SettingsPanel.stories.tsx` — cover
  the new field.
- `products/control-center/web/src/components/Board.tsx` — mount
  `<DeviceNameBanner />` in the overlay (`Board.tsx:647-649`); adjust banner
  `top` offsets so all stack without overlap.

### Worker
- **None.**

---

## Migration plan for existing logs (exact intent)

Target store: IndexedDB `cc-logs`, object store `entries` (per-device).

1. Bump `DB_VERSION` 3 → 4 in `store.ts`.
2. In `onupgradeneeded`, branch on the transaction: if the `entries` store
   already exists (upgrade from v3, not a fresh create), do **not** delete it.
   Instead resolve `deviceName = getDeviceName()` once and open a cursor over
   `entries`, and for each record without a `deviceName`, `cursor.update({
   ...record, deviceName })`. Keep the existing `ts` / `level` indexes.
3. Fresh installs create the store empty as today — nothing to backfill.
4. Native mirror: on `restoreFromNative`, stamp `deviceName = getDeviceName()`
   onto any parsed entry lacking it before writing to IndexedDB.
5. Read-time fallback in `LogsModal` guarantees display correctness regardless.

**Result — what old rows get:** every pre-existing entry ends up with
`deviceName` equal to this device's resolved name at first launch of the new
build (the user's chosen name if already set, else the derived auto default;
`"unknown"` only if UA/localStorage are both unavailable). No entry is deleted.

Drizzle-style equivalent, for readers who expected SQL (NOT implemented — logs
are not in Postgres): the analogue would be
`ALTER TABLE log ADD COLUMN device_name text NOT NULL DEFAULT '<resolved>'`
followed by a one-time backfill — but there is no such table.

---

## Test plan

Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run knip`.

Unit / component (Vitest, `bun run test`):
- `device-name.test.ts`: `deriveDefaultName` yields a non-empty readable slug
  from representative UA strings; `isDeviceNameSet` false before any set, true
  after `setDeviceName("iPad")`; `getDeviceName` returns auto default when unset
  and the user value when set; empty/whitespace `setDeviceName` clears and
  reverts to auto + `isSet` false again; auto default persists stably across a
  simulated reload (same value from `cc-device-name-auto`).
- Logger stamping: `write()` produces entries whose `deviceName ===
  getDeviceName()`; changing the name mid-session tags subsequent entries with
  the new name.
- Store migration (fake-indexeddb, reuse the existing store test harness/seams
  `setCapsForTests`/`resetForTests`): seed a v3 `cc-logs` with entries lacking
  `deviceName`, open at v4, assert every entry now has `deviceName ===
  getDeviceName()` and no entries were dropped; assert a fresh v4 open starts
  empty.
- Native restore normalize: parsed JSONL entries without `deviceName` gain it on
  restore.
- `DeviceNameBanner.test.tsx`: banner/notification present when unset; absent
  after `setDeviceName`; no dismiss control exists; correct notification id.
- `SettingsPanel` (or its story test): typing in the Device field calls
  `setDeviceName` and the value round-trips through `useDeviceName`.
- `LogsModal`: rows render the `deviceName` column; search matches on device
  name; missing `deviceName` falls back rather than rendering blank.

Storybook (Storybook-first invariant):
- `TextInput.stories.tsx`, `DeviceNameBanner.stories.tsx` (red, top-right),
  updated `SettingsPanel.stories.tsx` showing the Device section.

Manual verification (per repo `verify` habit): load the dashboard with no
`cc-device-name` set → red top-right banner "Please set your device name in
settings"; open Settings → Device, type a name → banner disappears immediately;
open Logs → new rows show the device name; confirm previously-stored rows also
show a device name (migration/backfill).

---

## Ordered task list for the implementer

1. Create `lib/device-name.ts` (store + derive + hook) with unit tests. No
   static import of `logger.ts`.
2. Add `ui/TextInput.tsx` + story.
3. Wire the Device section into `SettingsPanel.tsx` (+ story). Verify set/clear
   round-trips.
4. Create `DeviceNameBanner.tsx` (+ view + story + test); mount in `Board.tsx`
   overlay and tune banner stacking offsets.
5. Add `deviceName` to `LogEntry` (`types.ts`) and stamp it in `logger.ts`
   `write()`.
6. Bump `store.ts` `DB_VERSION` to 4 with the preserving/backfilling
   `onupgradeneeded`; add store-migration test. Add `deviceName` to the search
   haystack.
7. Normalize `deviceName` on native-mirror restore (`native.ts`).
8. Add the Device column + search + read-time fallback to `LogsModal.tsx`.
9. Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run knip`;
   manual-verify the four flows above.
```
