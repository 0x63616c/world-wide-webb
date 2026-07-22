# Track B (web): Hygiene, `createStore`, panel-session, board-camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip ~4k lines of dead web code, put every hand-rolled `useSyncExternalStore` singleton on one `createStore` primitive, extract the board camera behind a small interface, and replace four scattered idle/PIN mechanisms with one panel-session module (one activity clock; session end = dim + home + relock + reset).

**Architecture:** Hygiene first (pure deletions/renames, zero behavior change), then the `createStore` primitive (C4) that later modules build on, then the board-camera extraction (C6) as a pure refactor, then panel-session (C5) which consumes both — session end needs `camera.glideHome()`, so C6 lands before C5 (deliberate swap of the roadmap's C5/C6 listing order). C8 (settings descriptors) is deferred by roadmap decision 15 until C4 settles and is planned as an addendum, not here.

**Tech Stack:** React 18 `useSyncExternalStore`, TypeScript, vitest, Storybook, Bun workspaces.

**Reference:** `docs/superpowers/plans/2026-07-21-consolidation-roadmap.md` Track B section; decisions 13 (one Unlock, shared session, idle-reset expiry) and 15 (C8 late). Locked — do not re-litigate.

## Decisions made at plan time (Calum, 2026-07-22)

These override/refine the roadmap text and are settled — do not reopen during execution:

1. **Panel-session model:** ONE activity clock, touch is the only activity source. On idle
   timeout a single SESSION END event fires: screen dims + navigate back to board + camera
   glides home + PIN relocks + transient UI resets. There is no separate "dim early" stage —
   a dimmed panel always has a clean, locked, home-positioned board under it.
2. **Timeout:** configurable in settings; default 60s (matches today's idle-dim default).
3. **Wake:** first touch on a dimmed panel is swallowed (wake only, no click-through), then
   it's a fresh locked session.
4. **Nothing defers session end** — not timers, not flows. (A 1000-hour kitchen timer must
   not hold the panel unlocked.)
5. **C6 is a pure refactor**: behavior pinned before extraction; warts found get ticketed,
   never fixed inline.
6. **Repo layout fold IS in scope** (Calum explicitly reopened placement): `map-provision/`
   and `storybook/` move under `tools/`. `web/ api/ worker/` stay at root (locked
   roadmap decision 9 — untouched).
7. Whole track in this one doc; C8 as deferred stub (Calum chose this shape).

## Global Constraints

- Every task: green `bun run typecheck` + relevant tests, commit, push to `main` (deploys prod). Never batch tasks into one commit.
- Stage EXPLICIT paths only; never `git add -A` (shared checkout, parallel sessions). After each commit run `git show --stat HEAD` — if the lefthook format hook swept foreign files in, reset and recommit.
- Run the placeholder-tiles test after ANY change touching tile placement or board layout.
- Panel is a fixed 1366x1024 wall panel — not responsive.
- New UI states get Storybook stories first (storybook-first invariant).
- Panel audio only via `playCue()` sound bus; loudness is device volume, never in-app gain.
- No fake or placeholder data.
- `bun run knip` must stay clean (pre-push hook enforces).
- Use `writing-scalable-typescript` before writing/reviewing TS.

## File Structure

```
web/src/lib/store.ts                    NEW  C4: createStore primitive
web/src/lib/store.test.ts               NEW  C4: primitive's own suite
web/src/lib/board-camera/               NEW  C6: camera module (extracted from Board.tsx/useBoard.ts)
  index.ts                                   public interface
  camera.ts                                  pan/zoom state + SmoothDamp snap physics
  glide.ts                                   glideToTile / glideHome
web/src/lib/panel-session/              NEW  C5: session module
  index.ts                                   public interface
  session-store.ts                           activity clock + phase state (on createStore)
  session-effects.ts                         session-end fan-out (dim, nav, camera, relock, reset)
web/src/components/tiles/views/         RENAMED from tiles/modals/ (67 files)
web/src/lib/grid-constants.ts           MOD  single WALL_THICKNESS export
api/src/config/identity.ts              NEW  cross-service identity constants
tools/map-provision/                    MOVED from map-provision/
tools/storybook/                        MOVED from storybook/
DELETED: 4 concept files (~3951 lines), web/src/lib/open-settings-store.ts,
         5 double-catch blocks in api/src/trpc/routers/controls.ts
```

---

### Task 1: Delete dead concept files

**Files:**
- Delete: `web/src/components/concepts3/WorldConcepts.tsx` (1637 lines)
- Delete: `web/src/components/BoardVibeConcepts.tsx` (936 lines)
- Delete: `web/src/components/BoardRedesignConcepts.tsx` (689 lines)
- Delete: `web/src/components/hub/ClimateHubConcepts.tsx` (689 lines)

**Interfaces:** none — files have zero app imports (verified 2026-07-22; only comment references).

- [ ] **Step 1:** Re-verify zero imports: `grep -rn "WorldConcepts\|BoardVibeConcepts\|BoardRedesignConcepts\|ClimateHubConcepts" web/src storybook --include="*.ts*" | grep -v "Concepts.tsx:"` — expect empty (comment-only hits inside the deleted files themselves are fine).
- [ ] **Step 2:** `git rm` the 4 files (and `concepts3/` dir if now empty).
- [ ] **Step 3:** `bun run typecheck` green; `bun run knip` clean; run web test suite.
- [ ] **Step 4:** Commit `chore(web): delete dead concept files (~3.9k lines)`, explicit paths, push, watch CI.

### Task 2: Delete controls router double-catch

**Files:**
- Modify: `api/src/trpc/routers/controls.ts:79,106,131,153,184` (5 catch sites, not the roadmap's remembered 7)
- Test: existing controls router tests

**Interfaces:** procedures' external error behavior must be IDENTICAL — the tRPC error middleware already maps thrown service errors to `SERVICE_UNAVAILABLE`. Before deleting, read the middleware (grep `errorFormatter\|onError\|middleware` under `api/src/trpc/`) and pin the equivalence.

- [ ] **Step 1:** Read middleware; confirm it produces the same TRPCError code/message shape for uncaught service errors as the 5 inline catches do. If NOT identical → BLOCK and report (this is the task's parity gate).
- [ ] **Step 2:** Write/extend a router test asserting a failing service call surfaces as `SERVICE_UNAVAILABLE` (test through the public procedure, not the catch).
- [ ] **Step 3:** Delete the 5 try/catch wrappers, keeping the bare service calls.
- [ ] **Step 4:** Tests green, typecheck green. Commit `refactor(api): drop controls router double-catch (middleware owns it)`, push, watch CI.

### Task 3: Identity constants out of enforcers

**Files:**
- Create: `api/src/config/identity.ts`
- Modify: `api/src/services/climate-enforcer-service.ts:50` (remove `CLIMATE_DEVICE_ID` def)
- Modify: `api/src/services/sonos-sound-system-service.ts:32,37` (remove `TOPOLOGY_ANCHOR_IP`, `DESK_RF_BONDED_UUID` defs)
- Modify importers: `api/src/services/climate-service.ts:8`, `api/src/services/controls-service.ts:26`, `api/src/services/sonos-volume-enforcer-service.ts:28`

**Interfaces:**
- Produces `api/src/config/identity.ts`:

```ts
// Cross-service device identity. These are the stable IDs services rendezvous on;
// they live here, not in any one enforcer, because no service owns another's identity.
export const CLIMATE_DEVICE_ID = "climate-thermostat";
export const TOPOLOGY_ANCHOR_IP = "192.168.0.193";
export const DESK_RF_BONDED_UUID = "RINCON_804AF288FDBA01400";
```

- [ ] **Step 1:** Create `identity.ts` with the three constants (values verbatim from current sites).
- [ ] **Step 2:** Update the enforcers to import from config (keep a same-name re-export in each enforcer ONLY if >3 external import sites would churn; today there are 3 total, so update imports directly, no shims).
- [ ] **Step 3:** typecheck + api tests (climate + sonos suites) green. Commit `refactor(api): move cross-service identity constants to config/identity`, push, watch CI.

### Task 4: Fix stale guards + dedupe WALL_THICKNESS

**Files:**
- Modify: `web/src/lib/grid-constants.ts` (fix `:4` "12×6" comment → 12×9; add `WALL_THICKNESS` export)
- Modify: `web/src/components/tiles/__tests__/registry-guards.test.ts:3` (fix "12×6" comment)
- Modify: `web/src/components/layout-editor/LayoutEditorView.tsx:63`, `web/src/lib/placeholder-tiles.ts:40`, `web/src/lib/board-layout.ts:41` (delete local `WALL_THICKNESS = 2`, import from grid-constants)

**Interfaces:** Produces `export const WALL_THICKNESS = 2;` in `web/src/lib/grid-constants.ts`.

- [ ] **Step 1:** Confirm all three local values are `2` (they are, per 2026-07-22 inventory) — if any diverge, BLOCK: that's a live bug, not a dedupe.
- [ ] **Step 2:** Add the export, rewire the 3 sites, fix both stale comments to reference `GRID_COLS`/`GRID_ROWS` instead of literal dims.
- [ ] **Step 3:** Run placeholder-tiles test, board-layout tests, registry-guards test, layout-editor tests. typecheck. Commit `chore(web): single WALL_THICKNESS + fix stale 12x6 comments`, push, watch CI.

### Task 5: Rename `tiles/modals/` out of the Modal lie

**Files:**
- Rename dir: `web/src/components/tiles/modals/` → `web/src/components/tiles/views/` (67 files incl. `wiring/`)
- Modify importers: `web/src/components/tiles/detail/TileDetailHost.tsx:130`, `web/src/components/tiles/detail/registry.ts:52`, `GuestWifiTile.tsx`, `ControlsTile.tsx`, `DeployTile.tsx`, `ExpandedControlsModalView.tsx:7-8`, plus intra-dir imports
- Rename identifiers: every `*ModalView` component/file inside the moved dir → `*View` (e.g. `ExpandedControlsModalView` → `ExpandedControlsView`); storybook stories follow

**Interfaces:** none new — mechanical rename; `tile-registry.ts` untouched (no placement change).

- [ ] **Step 1:** `git mv web/src/components/tiles/modals web/src/components/tiles/views`.
- [ ] **Step 2:** Sweep imports (`grep -rn "tiles/modals" web storybook`) → update; expect zero remaining.
- [ ] **Step 3:** Rename `*ModalView` → `*View` identifiers + filenames within the moved tree and their import sites (`grep -rn "ModalView" web storybook` → zero after). Do NOT touch `modal-open-store.ts` (that's C5's concern) or genuinely-modal components outside this dir.
- [ ] **Step 4:** typecheck, web tests, storybook build (`bun run --filter @control-center/storybook build` or repo's storybook test project). Commit `refactor(web): tiles/modals -> tiles/views; ModalView components are full-screen views`, push, watch CI.

### Task 6: C4 — `createStore` primitive

**Files:**
- Create: `web/src/lib/store.ts`
- Create: `web/src/lib/store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void; // returns unsubscribe
}
export function createStore<T>(initial: T): Store<T>;
export function useStore<T>(store: Store<T>): T;            // useSyncExternalStore wrapper
export function useStoreSelector<T, U>(store: Store<T>, selector: (s: T) => U): U;
```

Semantics: `set` with identical value (Object.is) does not notify; listeners called synchronously after state swap; `useStoreSelector` re-renders only when selected slice changes (Object.is). No persistence, no async, no middleware — YAGNI; the 8+ existing stores need exactly this shape (verified against `device-settings.ts`, `settings.ts`, `tile-detail-store.ts` patterns).

- [ ] **Step 1:** Write failing tests: get/set roundtrip, functional set, no-notify on identical value, unsubscribe stops notifications, selector re-render gating (use `@testing-library/react` `renderHook`).
- [ ] **Step 2:** Run → fail (module missing).
- [ ] **Step 3:** Implement (~40 lines).
- [ ] **Step 4:** Tests green, typecheck. Commit `feat(web): createStore primitive (C4)`, push, watch CI.

### Task 7: C4 — migrate the hand-rolled singletons onto `createStore`

**Files (one commit per store, mechanical):**
- Modify: `web/src/lib/device-settings.ts`, `layout-edit-store.ts`, `guest-wifi-modal-store.ts`, `settings.ts`, `device-name.ts`, `tile-detail-store.ts`, `modal-open-store.ts`, `idle-hold-store.ts`, `time-suite/alarm-store.ts`, `time-suite/timer-store.ts`, `time-suite/stopwatch-store.ts`
- Skip: `open-settings-store.ts` (deleted in Task 9 — don't churn it), `useIsNarrow.ts` + `useNotifications.ts` (external-system subscriptions, not state singletons — leave unless trivially identical shape; note the call in the task report)

**Interfaces:** each store's PUBLIC exports (hooks, action functions) keep their exact names and signatures — only the internal getSnapshot/subscribe plumbing collapses onto `createStore`. Existing tests are the behavior pin; do not rewrite tests except where they reached into now-deleted internals.

- [ ] **Step 1 (×11):** For each store: swap internals to `const store = createStore<State>(initial)` + re-express actions via `store.set`, hooks via `useStore`/`useStoreSelector`. Run that store's tests + its consumers' tests. Commit `refactor(web): <name> onto createStore`, push. Watch CI at least on first + last; intermediate pushes may batch CI watch.
- [ ] **Step 2:** After last: `grep -rn "useSyncExternalStore" web/src --include="*.ts*"` → only `store.ts` (+ the 2 deliberate skips if left). knip clean.

### Task 8: C6 — board-camera module (pure refactor)

**Files:**
- Create: `web/src/lib/board-camera/index.ts`, `camera.ts`, `glide.ts`
- Modify: `web/src/components/Board.tsx` (1000+ lines; pointer refs `:554`, SNAP_CSS map `:77-83`, `glideToTile` `:646+`)
- Modify: `web/src/components/hooks/useBoard.ts` (709 lines; SmoothDamp `:47-66`, `useIdleReset` `:582+`)
- Consumes: `idle-hold-store` (already on createStore from Task 7)

**Interfaces:**
- Produces `web/src/lib/board-camera/index.ts`:

```ts
export interface BoardCamera {
  panTo(target: TileId | { x: number; y: number }): void;
  glideHome(): void;               // the idle glide-home animation, callable on demand
  freeze(): void;                  // suspend physics (layout-edit mode)
  unfreeze(): void;
  isSettling(): boolean;           // true while snap/glide animation in flight
  subscribe(listener: () => void): () => void;
}
export const boardCamera: BoardCamera;
```

SmoothDamp constants (`SNAP_SMOOTH_TIME=0.32`, `SNAP_DEADZONE=6`, `SNAP_STOP_PX=0.5`, `SNAP_STOP_VEL=6`, `SNAP_MAX_DT=0.05`) and the 5 snap modes (`proximity, mandatory, mandatory-settle, none, spring`) move VERBATIM — any value change is a wart → ticket, don't fix.

- [ ] **Step 1:** Pin behavior: ensure existing Board/useBoard tests pass pre-change; add a characterization test for `glideToTile` target math if none exists.
- [ ] **Step 2:** Extract physics (`camera.ts`) + glide (`glide.ts`) with the module owning pointer/velocity refs; `useBoard.ts` hooks become thin adapters over `boardCamera`; `Board.tsx` reads snap-mode CSS from the module.
- [ ] **Step 3:** All board tests + placeholder-tiles test green; manual smoke via Storybook board story (drag, snap, idle glide) — screenshot in task report.
- [ ] **Step 4:** Commit `refactor(web): extract board-camera module (C6)`, push, watch CI. Ticket any warts found (list in commit body).

### Task 9: C5 — panel-session module

**Files:**
- Create: `web/src/lib/panel-session/index.ts`, `session-store.ts`, `session-effects.ts` (+ tests per file)
- Delete: `web/src/lib/open-settings-store.ts` (51 lines; consumer `SettingsButton` rewires)
- Modify: `web/src/components/tiles/detail/types.ts:36` (`requiresPin?: true` → `sensitive?: true`), `TileDetailHost.tsx:53-59`, `detail/wiring/activity.tsx:75`
- Modify: today's idle-dim implementation (`useIdleDim` in `useBoard.ts`) + idle-dim setting in the Settings page → both re-point at panel-session
- Consumes: `createStore` (Task 6), `boardCamera.glideHome()` + `isSettling` (Task 8), existing navigation + dim plumbing

**Interfaces:**
- Produces `web/src/lib/panel-session/index.ts`:

```ts
export type SessionPhase = "active" | "ended"; // ended = dimmed, locked, home
export interface PanelSession {
  touch(): void;                    // ANY user touch; the only activity source
  phase(): SessionPhase;
  usePhase(): SessionPhase;
  unlock(): void;                   // PIN success -> unlocked for rest of session
  isUnlocked(): boolean;
  useIsUnlocked(): boolean;
  onSessionEnd(cb: () => void): () => void;  // effects fan-out registration
  setTimeoutMs(ms: number): void;   // from settings; default 60_000
}
export const panelSession: PanelSession;
```

Session-end fan-out (in `session-effects.ts`, registered once at app mount): dim screen → navigate to board → `boardCamera.glideHome()` → clear unlock → reset transient UI (close tile detail via `tile-detail-store`, clear `modal-open-store`, drop pending-settings state — which is why `open-settings-store` deletes: its "pending page" concept is transient session state). Wake: first touchstart on `phase === "ended"` is `preventDefault`ed + swallowed, calls `touch()`, new active locked session.

- [ ] **Step 1:** TDD the store: fake timers; touch → active; timeout → ended exactly once; touch while ended → active + swallowed-flag; unlock survives touches, dies at session end; setTimeoutMs live-rebases the clock.
- [ ] **Step 2:** Implement `session-store.ts` on `createStore`; suite green.
- [ ] **Step 3:** TDD + implement `session-effects.ts` with injected effect fns (nav, dim, camera, resets as parameters — test with spies, prod wiring passes real ones).
- [ ] **Step 4:** Rewire: idle-dim → session (delete old timer), settings page timeout field targets `setTimeoutMs` (existing idle-dim setting becomes THE session timeout; keep stored settings key or migrate it — check `settings.ts` schema and do a compatible rename), PIN gate (`TileDetailHost`) consumes `useIsUnlocked` + `sensitive` flag, `SettingsButton` loses open-settings-store.
- [ ] **Step 5:** Storybook story for the ended→wake sequence; full web suite + typecheck + knip green (open-settings-store fully gone). Commit in 2-3 coherent slices (`feat(web): panel-session store (C5)`, `feat(web): session-end effects + wake`, `refactor(web): pin/dim/settings onto panel-session`), push each, watch CI. Verify on the real panel after deploy: idle 60s → dim+home+lock; wake touch swallowed.

### Task 10: Layout fold — `map-provision/` + `storybook/` → `tools/`

**Files:**
- Move: `map-provision/` → `tools/map-provision/`; `storybook/` → `tools/storybook/`
- Modify: root `package.json` workspaces (`"map-provision"` → `"tools/map-provision"`, `"storybook"` → `"tools/storybook"`), `bun.lock` (via `bun install`)
- Modify: `.github/workflows/*` path filters mentioning `storybook/` or `map-provision/`, `web/Dockerfile.storybook` COPY paths, any `--filter`/`--cwd` scripts, tsconfig path refs
- **Gate:** root `web/ api/ worker/` do NOT move (locked decision 9)

- [ ] **Step 1:** `grep -rn "map-provision\|storybook/" .github package.json web/Dockerfile* infra --include="*" | grep -v node_modules` — build the full rewrite list BEFORE moving.
- [ ] **Step 2:** `git mv`, rewrite refs, `bun install`, typecheck, knip, storybook build, `bun run test:storybook`.
- [ ] **Step 3:** Commit `chore: move map-provision + storybook under tools/`, push, watch CI **carefully** — this touches CI path filters themselves; verify the storybook image still builds and per-product filters still trigger (check the run's job list). Recover digest strands per standing risk if a run gets cancelled.

### Task 11: C8 stub + track close-out

C8 (settings field-descriptor table) is DEFERRED by roadmap decision 15 until C4 has settled in prod; plan it as an addendum to this doc at that point (Calum approved this shape 2026-07-22). This task is docs-only close-out:

- [ ] **Step 1:** Update `CODEBASE_OVERVIEW.md` (store primitive, panel-session, board-camera, tools/ layout) + roadmap file (Track B status, C5/C6 order swap note, 5-not-7 catch count, C8 addendum pointer).
- [ ] **Step 2:** Commit `docs: track B landed; C8 addendum pending`, push.

## Self-Review Notes (author)

- Spec coverage: hygiene strip (Tasks 1-5) ✔; C4 (6-7) ✔; C5 (9) ✔; C6 (8) ✔; C8 deferred by decision ✔; layout fold (10) per Calum's explicit reopen ✔.
- Roadmap said "7 occurrences" of double-catch and "7 singletons": live inventory (2026-07-22) found 5 and 11 — plan uses verified numbers.
- C5/C6 order deliberately swapped vs roadmap listing: session-end calls `boardCamera.glideHome()`.
- Type consistency: `boardCamera.glideHome`/`isSettling` (Task 8) match Task 9's consumption; `createStore`/`useStore` (Task 6) match Task 7/9 usage; `sensitive` flag named consistently.
- Placeholder scan: no TBDs; Task 9 Step 4 settings-key migration is bounded ("check settings.ts schema, compatible rename") — implementer decision with explicit instruction, not a placeholder.
