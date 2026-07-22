# Track A (C1): `packages/core` Device-State Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/core` holding the device-state store — interface + pg adapter + in-memory adapter + default instance — owning the `device_state` table, and migrate all 5 writers and 8+ readers onto it, deleting the hand-built drizzle `SelectChain` fakes from the 4 enforcer test suites.

**Architecture:** A deep module: one small `DeviceStateStore` interface hides the drizzle/pg plumbing, the command-window stamping, and the desired-over-reported merge. Two adapters at the seam (pg for prod, in-memory for tests) verified by one shared contract test suite. Services accept the store as a parameter with the pg default, so prod call sites don't change shape while tests inject memory. The `device_state` schema (table + `DeviceStateValue` unions + `DeviceKind` + command-window constants + merge) moves into `packages/core`; `api/src/db/schema.ts` re-exports so drizzle migrations and every existing import stay stable.

**Tech Stack:** Bun workspaces, TypeScript, drizzle-orm (node-postgres), vitest.

**Reference:** Roadmap decision 2 (core birth scope = device-state store only) and decision 10 (interface + pg adapter + in-memory adapter + default instance; services take store as param) in `docs/superpowers/plans/2026-07-21-consolidation-roadmap.md`. Both are locked — do not re-litigate.

## Global Constraints

- Work on `main`. Commit per coherent slice; push immediately; push = prod deploy. Verify `https://app.worldwidewebb.co` still answers 302 after each deploy that ships api/worker.
- Stage explicit paths only (`git add <paths>`), NEVER `-A`. Parallel sessions share this checkout. Check `git show --stat HEAD` after every commit.
- **Zero behavior change.** This whole track is a refactor: every task must preserve current runtime behavior exactly (same SQL effects, same failure policy — desired writes THROW, never swallow).
- **Zero schema drift.** `device_state` table shape must not change. Gate: `cd drizzle && bun run db:generate` (or the repo's drizzle generate script — check `drizzle/package.json`) produces NO new migration file. If it generates one, the schema move is wrong — fix, never commit a migration.
- New package name: `@www/core`. Import specifier for consumers: `@www/core`.
- `packages/core` must NOT import `env`, HA integrations, or construct a pg Pool — the pg adapter RECEIVES a drizzle db instance. The default prod instance lives in `api/src/db/device-state-store.ts` (decision 2: no env/queue/HA in core yet).
- Migrated test suites must NOT `vi.mock("../db/index", ...)` for device-state access — they inject the in-memory store. (Roadmap end-state: "tests reach modules through interfaces — no vi.mock of db/HA singletons".)
- Backend code uses structured logging (`getLogger()`), IDs stay `prefix_<id>` where present.
- Known environmental flake: `api/src/__tests__/guest-server.test.ts` DB-unreachable test fails when a local Tilt Postgres runs — verify against clean HEAD before blaming your diff.
- Biome-formatted repo: run `bun run lint` before commit; lefthook may re-format — verify staged set stayed yours.

## File Structure

```
packages/core/
  package.json              # @www/core, exports ".": "./src/index.ts" (match @www/platform)
  tsconfig.json             # copy packages/platform/tsconfig.json
  src/
    index.ts                # barrel: schema, store types, adapters, merge, command-window
    device-state/
      schema.ts             # deviceState pgTable + DeviceLightState/DeviceClimateState/
                            #   DeviceSpeakerState/DeviceStateValue/LightColor + DeviceKind
      command-window.ts     # COMMAND_WINDOW_MS + stampCommandWindow (moved from api)
      merge.ts              # mergeDeviceState + the pure guards it needs
      store.ts              # DeviceStateStore interface + input types
      memory.ts             # createInMemoryDeviceStateStore()
      pg.ts                 # createPgDeviceStateStore(db)
      store-contract.ts     # shared contract suite run against both adapters
  test/
    memory.test.ts          # contract suite against memory adapter
    merge.test.ts           # moved merge tests
api/src/db/schema.ts        # re-exports device-state schema from @www/core (table def deleted here)
api/src/db/device-state-store.ts  # NEW: default prod instance (pg adapter over api's db)
api/src/services/desired-state-store.ts   # DELETED (Task 5)
api/src/services/command-window.ts        # becomes re-export shim, then deleted when knip-clean
```

---

### Task 1: Scaffold `packages/core` and move the device-state schema

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/device-state/schema.ts`, `packages/core/src/device-state/command-window.ts`
- Modify: `api/src/db/schema.ts` (delete moved block, re-export), `api/src/services/command-window.ts` (re-export shim), `api/src/services/device-state-mapping.ts` (DeviceKind moves out, re-export), `api/package.json` (dep on `@www/core`), `api/Dockerfile:33-42` (manifest COPY line), `worker/Dockerfile` (manifest COPY line if it lists package manifests individually — check lines 34-36)
- Test: existing suites (`cd api && bun run test`), drizzle no-drift gate

**Interfaces:**
- Consumes: current `api/src/db/schema.ts:120-142` (`deviceState` table), the `Device*State`/`DeviceStateValue`/`LightColor` types above it, `api/src/services/command-window.ts` (7-11), `DeviceKind` from `api/src/services/device-state-mapping.ts:11-18`.
- Produces: `@www/core` exporting `deviceState`, `DeviceLightState`, `DeviceClimateState`, `DeviceSpeakerState`, `DeviceStateValue`, `LightColor`, `DeviceKind`, `COMMAND_WINDOW_MS`, `stampCommandWindow`. Every later task imports these from `@www/core`.

- [ ] **Step 1: Create the package manifest** — copy `packages/platform/package.json` shape:

```json
{
  "name": "@www/core",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "<same version as api/package.json — copy it verbatim>"
  },
  "devDependencies": {
    "@types/bun": "<copy from packages/platform>",
    "typescript": "<copy from packages/platform>",
    "vitest": "<copy from packages/platform>"
  }
}
```

Copy `packages/platform/tsconfig.json` verbatim as `packages/core/tsconfig.json`. Run `bun install` (updates `bun.lock` — stage it).

- [ ] **Step 2: Move the schema block.** Cut from `api/src/db/schema.ts` into `packages/core/src/device-state/schema.ts`: the `deviceState` pgTable (current lines 120-142), plus `DeviceLightState`, `LightColor`, `DeviceClimateState`, `DeviceSpeakerState`, `DeviceStateValue` (the doc comments move too). Add the drizzle imports the block needs (`pgTable, text, jsonb, timestamp, boolean, uniqueIndex, index` from `drizzle-orm/pg-core`). Append `DeviceKind` moved verbatim from `api/src/services/device-state-mapping.ts:11-18`. Move `api/src/services/command-window.ts` content verbatim to `packages/core/src/device-state/command-window.ts`.

- [ ] **Step 3: Re-export shims.** In `api/src/db/schema.ts`, where the block was:

```typescript
export {
  deviceState,
  DeviceKind,
  type DeviceLightState,
  type LightColor,
  type DeviceClimateState,
  type DeviceSpeakerState,
  type DeviceStateValue,
} from "@www/core";
```

In `api/src/services/command-window.ts`: `export { COMMAND_WINDOW_MS, stampCommandWindow } from "@www/core";`
In `api/src/services/device-state-mapping.ts`: delete the `DeviceKind` const+type (lines 11-18), add `export { DeviceKind } from "@www/core";` and fix its own internal uses (it references `DeviceKind.Climate` etc. in `ownerOf` — import at top instead). `packages/core/src/index.ts` barrels everything from both device-state modules. Add `"@www/core": "workspace:*"` to `api/package.json` dependencies.

- [ ] **Step 4: Dockerfiles.** `api/Dockerfile:33-42` lists package manifests before `COPY packages packages` — add the `packages/core/package.json` COPY line matching the existing pattern. Same for `worker/Dockerfile` if it lists manifests individually (check lines 34-36). Run `bun scripts/check-dockerfile-manifests.ts` if it exists in `scripts/` (check first — Track 0 ticket-later item, may not exist yet).

- [ ] **Step 5: Gates.** Run: `bun run typecheck` (root) — PASS. `cd api && bun run test` — PASS (no behavior change, all suites green). Drizzle no-drift: run the generate script in `drizzle/` — expect "No schema changes" / zero new migration files (`git status drizzle/` clean). `bun run lint` — PASS. `cd packages/core && bun run typecheck` — PASS.

- [ ] **Step 6: Commit + push + watch.**

```bash
git add packages/core api/src/db/schema.ts api/src/services/command-window.ts api/src/services/device-state-mapping.ts api/package.json api/Dockerfile worker/Dockerfile bun.lock
git commit -m "feat(core): birth packages/core with device_state schema + command window"
git push
gh run watch <run-id> --exit-status   # foreground; then curl -sI https://app.worldwidewebb.co | head -1 → 302
```

---

### Task 2: `DeviceStateStore` interface + in-memory adapter + contract suite

**Files:**
- Create: `packages/core/src/device-state/store.ts`, `packages/core/src/device-state/memory.ts`, `packages/core/src/device-state/store-contract.ts`, `packages/core/test/memory.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 1's `@www/core` schema exports.
- Produces (exact — later tasks depend on these signatures):

```typescript
// packages/core/src/device-state/store.ts
import type { DeviceKind, DeviceStateValue } from "./schema";
import { deviceState } from "./schema";

/** A device_state row as read back from the store (drizzle row shape). */
export type DeviceStateRow = typeof deviceState.$inferSelect;

/** Upsert of desired keyed on entityId — creates the row (available:true) on first sight. */
export interface UpsertDesired {
  id: string;
  kind: DeviceKind;
  entityId: string;
  domain: string;
  label: string;
  desired: DeviceStateValue;
  /** Command-window length in ms; defaults to COMMAND_WINDOW_MS. */
  windowMs?: number;
}

/** In-place update of an existing row's desired, keyed on id. Missing row = silent no-op. */
export interface UpdateDesired {
  id: string;
  desired: DeviceStateValue;
  windowMs?: number;
}

/** First-sight row creation by a reconcile loop. Conflict on entityId = no-op. */
export interface SeedDevice {
  id: string;
  kind: DeviceKind;
  entityId: string;
  domain: string;
  label: string;
  reported?: DeviceStateValue | null;
  desired?: DeviceStateValue | null;
  available: boolean;
}

/** One reconcile-cycle persistence of observed state, keyed on id. */
export interface WriteReported {
  id: string;
  reported: DeviceStateValue | null;
  available: boolean;
  /** True when the reported VALUE changed vs the previous cycle → stamps reportedChangedAtUtc. */
  changed?: boolean;
  /** Adopt: absorb external drift — also write this as desired (+desiredAtUtc), no window. */
  adoptDesired?: DeviceStateValue;
  /** Injectable clock for deterministic tests; defaults to new Date(). */
  now?: Date;
}

export interface ListFilter {
  kind?: DeviceKind;
  entityIds?: readonly string[];
}

/**
 * The device-state store: the ONLY code that touches the device_state table.
 * Failure policy is THROW everywhere — a desired write is the mutation's only
 * effect; a swallowed error is fabricated success (carried from desired-state-store).
 */
export interface DeviceStateStore {
  read(id: string): Promise<DeviceStateRow | null>;
  list(filter?: ListFilter): Promise<DeviceStateRow[]>;
  /** Rows whose desiredUntilUtc is non-null and < now. */
  listExpiredWindows(now: Date): Promise<DeviceStateRow[]>;
  /** read(id) + mergeDeviceState overlay; null when the row is missing. */
  readEffective(id: string): Promise<MergedDeviceState | null>;
  seed(input: SeedDevice): Promise<void>;
  upsertDesired(input: UpsertDesired): Promise<void>;
  updateDesired(input: UpdateDesired): Promise<void>;
  /** Null the desired triple (state/at/until), keyed on id. Missing row = no-op. */
  clearDesired(id: string): Promise<void>;
  writeReported(input: WriteReported): Promise<void>;
}
```

(`MergedDeviceState` arrives in Task 4; until then declare `readEffective` returning `Promise<{ state: DeviceStateValue | null; pending: boolean; available: boolean } | null>` — that IS `MergedDeviceState`'s shape, so Task 4 only swaps the named type in.)

- [ ] **Step 1: Write the contract suite first** (`store-contract.ts` exports `runDeviceStateStoreContract(makeStore: () => Promise<DeviceStateStore> | DeviceStateStore)` using `describe/it/expect` from vitest). Port the behavior matrix from `api/src/__tests__/desired-state-store.test.ts` (lines 56-161) as contract cases, plus the new ops. Required cases (write each as a real `it()` with full assertions):
  - `upsertDesired` creates a full row on first sight: `available: true`, `desiredAtUtc` set, `desiredUntilUtc = desiredAtUtc + COMMAND_WINDOW_MS` by default, `windowMs` override respected.
  - `upsertDesired` on existing entityId overwrites ONLY desired columns (+window) — label/reported/availability untouched.
  - `updateDesired` on missing id is a silent no-op; on existing id updates the desired triple only.
  - `seed` inserts; `seed` again with same entityId is a no-op (first write wins).
  - `writeReported` sets reportedState/reportedAtUtc/available/updatedAtUtc; `changed: true` additionally stamps reportedChangedAtUtc; `changed` absent/false leaves reportedChangedAtUtc untouched; `adoptDesired` also sets desiredState+desiredAtUtc and leaves desiredUntilUtc alone.
  - `clearDesired` nulls desiredState/desiredAtUtc/desiredUntilUtc, leaves reported intact.
  - `list()` all; `list({kind})`; `list({entityIds})`; `listExpiredWindows(now)` returns only rows with non-null desiredUntilUtc < now.
  - `readEffective` on missing row → null; desired overlays reported per-field; no desired → reported passthrough, pending false. (Assert against the merge behavior documented at `api/src/services/device-state-mapping.ts:380-410`.)
- [ ] **Step 2: Run against a stub store to verify the suite fails** — `cd packages/core && bun run test` with `memory.test.ts` calling `runDeviceStateStoreContract(() => createInMemoryDeviceStateStore())` before the adapter exists. Expected: FAIL (module not found / methods undefined).
- [ ] **Step 3: Implement `memory.ts`.** A `Map<string, DeviceStateRow>` keyed by id with an entityId unique check; each method implements exactly the semantics above; timestamps via `input.now ?? new Date()` for writeReported and `new Date()` elsewhere; desired writes compute window via `stampCommandWindow`/`windowMs` (same logic as `api/src/services/desired-state-store.ts:55-57` — copy `windowEnd` in). Rows returned are structural clones (no shared references). For `readEffective`, until Task 4, inline the current merge behavior by importing nothing — implement `read` + a local call to a `merge` placeholder is NOT allowed; instead implement `readEffective` by porting `mergeDeviceState` in Task 4 and, in THIS task, implement it as `read(id)` + the overlay algorithm copied verbatim from `api/src/services/device-state-mapping.ts:390-410` into a private helper in `memory.ts` marked `// TODO(task-4): replace with core merge module` — Task 4 deletes the copy. (Contract cases for readEffective stay green across the swap.)
- [ ] **Step 4: Run** `cd packages/core && bun run test` — PASS, output pristine. `bun run typecheck` root — PASS.
- [ ] **Step 5: Commit + push.**

```bash
git add packages/core
git commit -m "feat(core): DeviceStateStore interface, in-memory adapter, contract suite"
git push
```

---

### Task 3: pg adapter + default prod instance

**Files:**
- Create: `packages/core/src/device-state/pg.ts`, `api/src/db/device-state-store.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/pg.test.ts` (builder-mock style), optional pg-backed contract run

**Interfaces:**
- Consumes: Task 2's `DeviceStateStore` + input types; `deviceState` table.
- Produces: `createPgDeviceStateStore(db: PgDatabase): DeviceStateStore` from `@www/core`; `export const deviceStateStore: DeviceStateStore` from `api/src/db/device-state-store.ts` (the default instance every service imports).

- [ ] **Step 1: Write `pg.ts`.** Factory takes the drizzle instance (type it as the minimal structural surface actually used — `Pick`-style parameter typed from drizzle's `NodePgDatabase<Record<string, unknown>>`; match how api types `db`). Each method is the drizzle call currently at the legacy sites, centralized:
  - `read`: `db.select().from(deviceState).where(eq(deviceState.id, id)).limit(1)` → `rows[0] ?? null`.
  - `list`: base select; `kind` → `eq(deviceState.kind, kind)`; `entityIds` → `inArray(deviceState.entityId, [...entityIds])`; both → `and(...)`.
  - `listExpiredWindows`: `where(and(isNotNull(deviceState.desiredUntilUtc), lt(deviceState.desiredUntilUtc, now)))` (verbatim from `api/src/services/device-sync-service.ts:78-81`).
  - `upsertDesired` / `updateDesired`: move the bodies of `api/src/services/desired-state-store.ts:65-99` verbatim (including `windowEnd`, doc comments, THROW policy).
  - `seed`: `db.insert(deviceState).values({...input, desiredState: input.desired ?? null, reportedState: input.reported ?? null}).onConflictDoNothing({ target: deviceState.entityId })`.
  - `clearDesired`: `db.update(deviceState).set({ desiredState: null, desiredAtUtc: null, desiredUntilUtc: null }).where(eq(deviceState.id, id))` (shape from `device-sync-service.ts:67-70`).
  - `writeReported`: one UPDATE with `reportedState`, `reportedAtUtc: now`, `available`, `updatedAtUtc: now`, spread `changed ? { reportedChangedAtUtc: now } : {}` and `adoptDesired ? { desiredState: adoptDesired, desiredAtUtc: now } : {}` — the union of the write shapes at `light-enforcer-service.ts:242-313` and `device-sync-service.ts:50-58`.
  - `readEffective`: `read(id)` then the same merge helper as memory (Task 4 unifies).
- [ ] **Step 2: Tests.** `packages/core/test/pg.test.ts` in the existing repo pattern for thin drizzle wrappers (see `api/src/__tests__/desired-state-store.test.ts:16-41` for the builder-mock shape): a fake `db` object capturing `insert().values().onConflictDoUpdate()` / `update().set().where()` / `select().from().where().limit()` chains, asserting the exact column sets and WHERE keys per method. Additionally: run the full contract suite against the pg adapter behind an env gate — `const url = process.env.CORE_PG_TEST_URL; describe.skipIf(!url)("pg contract", ...)` creating a throwaway table namespace per run. CI does not set the var; local runs against Tilt Postgres can.
- [ ] **Step 3: Default instance.** `api/src/db/device-state-store.ts`:

```typescript
import { createPgDeviceStateStore } from "@www/core";
import { db } from "./index";

/** The prod device-state store: pg adapter over the api's singleton drizzle db. */
export const deviceStateStore = createPgDeviceStateStore(db);
```

- [ ] **Step 4: Run** `cd packages/core && bun run test` — PASS. Root typecheck — PASS.
- [ ] **Step 5: Commit + push.**

```bash
git add packages/core api/src/db/device-state-store.ts
git commit -m "feat(core): pg adapter + default prod device-state store instance"
git push
```

---

### Task 4: Move the merge into core; `readEffective` unified

**Files:**
- Create: `packages/core/src/device-state/merge.ts`, `packages/core/test/merge.test.ts`
- Modify: `api/src/services/device-state-mapping.ts` (delete moved pure functions, re-export), `packages/core/src/device-state/memory.ts` + `pg.ts` (drop the private merge copies), `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `DeviceStateValue` unions.
- Produces from `@www/core`: `mergeDeviceState(device, now?): MergedDeviceState`, `MergedDeviceState`, `isLightState`, `isClimateState`, `isSpeakerState` (if it exists in device-state-mapping — check), `sanitizeClimateDesired`, and whatever pure helpers `mergeDeviceState` transitively needs (`converged`, per-field comparators). **Rule:** a function moves to core only if it is pure over the schema types — anything touching `HaEntity`, `findLight`, or config stays in `api/src/services/device-state-mapping.ts` (`ownerOf`, `mapHaToReported`, `stateEquals` if it references HA shapes — check its body; if pure, it may move).
- [ ] **Step 1:** Move `mergeDeviceState` (`device-state-mapping.ts:380-410`) + its pure dependency closure into `merge.ts` with doc comments. `device-state-mapping.ts` re-exports every moved name so zero call sites change.
- [ ] **Step 2:** Move the merge-related test cases from wherever they live (`grep -rn "mergeDeviceState" api/src/__tests__/`) into `packages/core/test/merge.test.ts`; leave HA-mapping tests behind.
- [ ] **Step 3:** Replace the two private merge copies in `memory.ts`/`pg.ts` with the shared `mergeDeviceState`; delete the `TODO(task-4)` helper.
- [ ] **Step 4: Run** `cd packages/core && bun run test` + `cd api && bun run test` — PASS. Root typecheck — PASS.
- [ ] **Step 5: Commit + push.**

```bash
git add packages/core api/src/services/device-state-mapping.ts api/src/__tests__
git commit -m "refactor(core): mergeDeviceState + pure guards move to @www/core"
git push
```

---

### Task 5: Desired writers onto the store; delete `desired-state-store.ts`

**Files:**
- Modify: `api/src/services/controls-service.ts`, `api/src/services/climate-service.ts`, `api/src/services/sonos-volume-enforcer-service.ts` (its `upsertDesired` import only — full store migration is Task 8)
- Delete: `api/src/services/desired-state-store.ts`, `api/src/__tests__/desired-state-store.test.ts`
- Test: the callers' existing suites

**Interfaces:**
- Consumes: `deviceStateStore` from `api/src/db/device-state-store.ts` (Task 3); `UpsertDesired`/`UpdateDesired` from `@www/core` (field `desired`, same as before — the input types were ported verbatim).

- [ ] **Step 1:** In each caller, replace `import { upsertDesired, updateDesired } from "./desired-state-store"` with the store: services that already take injectable deps follow their existing pattern; otherwise call `deviceStateStore.upsertDesired(...)` via a module-level `const store = deviceStateStore` that tests can't reach YET — where the caller's test suite mocks `./desired-state-store` today, change the service function signature to accept `store: DeviceStateStore = deviceStateStore` as trailing parameter (decision 10: services take the store as param) and update its tests to pass `createInMemoryDeviceStateStore()`.
- [ ] **Step 2:** Delete `api/src/services/desired-state-store.ts` + its test file (matrix already lives in the contract suite since Task 2 — verify every behavior case from the deleted file exists in `store-contract.ts` before deleting; add any missing case FIRST).
- [ ] **Step 3: Run** `cd api && bun run test` — PASS. Root typecheck + `bun run knip` — PASS (no orphaned exports).
- [ ] **Step 4: Commit + push; watch CI; curl panel 302.**

```bash
git add api/src/services api/src/__tests__ 
git commit -m "refactor(api): desired writers onto DeviceStateStore; desired-state-store dies"
git push
```

---

### Task 6: light-enforcer onto the store

**Files:**
- Modify: `api/src/services/light-enforcer-service.ts`, `api/src/__tests__/light-enforcer-service.test.ts`

**Interfaces:**
- Consumes: `DeviceStateStore`, `createInMemoryDeviceStateStore`, `deviceStateStore` default.
- Produces: `runEnforcerCycle(store: DeviceStateStore = deviceStateStore)` and `reconcile(snapshot, store)` — worker call sites (`api/src/worker-deps.ts` re-exports; check `grep -rn "runEnforcerCycle" api/src worker/src`) keep working via the default.

- [ ] **Step 1 (tests first):** Rewrite the cycle tests (`light-enforcer-service.test.ts:290-393`): delete the `SelectChain` class (254-273) and the `vi.mock("../db/index", ...)` (line 19); seed a `createInMemoryDeviceStateStore()` with rows and pass it in; assert post-cycle store contents via `store.read(...)`. Pure tests (`lightStateConverged`, `decideEnforcement`, lines 44-249) are untouched. Run: FAIL (signature doesn't accept store yet).
- [ ] **Step 2:** Thread the store: `reconcile` replaces `db.select()...inArray(...)` (lines 182-185) with `store.list({ entityIds: [...MANAGED_ENTITY_IDS] })`; `applyDecision` (lines 225-317) becomes store calls —
  - `unreachable` → `store.writeReported({ id, reported: mapped.reported, available: false, now })`
  - `seed`/`adopt` → `store.writeReported({ id, reported: mapped.reported, available, adoptDesired: decision.desired, now })` (keep the adopt debug log)
  - `push`/`noop` → HA call (push only) then `store.writeReported({ id, reported: mapped.reported, available, now })`
  - **Parity check:** current code does NOT stamp `reportedChangedAtUtc` here (that's device-sync-only) — so no `changed` flag; current code sets `updatedAtUtc` — writeReported already does.
  - `isPartyActive` (lampMode table, lines 216-223) is NOT device_state — leave its direct db access alone.
- [ ] **Step 3: Run** the suite — PASS, output pristine. Full `cd api && bun run test` — PASS.
- [ ] **Step 4: Commit + push; watch CI; curl panel 302** (worker image ships this).

```bash
git add api/src/services/light-enforcer-service.ts api/src/__tests__/light-enforcer-service.test.ts
git commit -m "refactor(api): light-enforcer onto DeviceStateStore, SelectChain fake dies"
git push
```

---

### Task 7: climate-enforcer onto the store

**Files:**
- Modify: `api/src/services/climate-enforcer-service.ts`, `api/src/__tests__/climate-enforcer-service.test.ts`

**Interfaces:**
- Consumes/produces: same pattern as Task 6 — `runClimateEnforcerCycle(store: DeviceStateStore = deviceStateStore)`.

- [ ] **Step 1 (tests first):** delete `SelectChain` (test lines 273-288), the insert-capture helper (298-311), the `vi.mock` (line 20); seed the in-memory store; decision-matrix pure tests (48-268) untouched. Run: FAIL.
- [ ] **Step 2:** Map the write sites (from the terrain map — verify each against the file):
  - line ~151 seed INSERT → `store.seed({...})` (first-sight thermostat row)
  - ~212 unreachable → `store.writeReported({ id, reported, available: false, now })`
  - ~222 adopt (reported+desired) → `store.writeReported({ id, reported, available, adoptDesired, now })`
  - ~236 push, ~243 noop → `store.writeReported({ id, reported, available, now })`
  - read at ~192 → `store.read(CLIMATE_DEVICE_ID)`
  - **Parity check:** if any site writes columns outside writeReported's set (e.g. reportedChangedAtUtc, or desired window fields), STOP and report — the interface may need a deliberate extension, not an ad-hoc column.
- [ ] **Step 3: Run** suite + full api tests — PASS.
- [ ] **Step 4: Commit + push.**

```bash
git add api/src/services/climate-enforcer-service.ts api/src/__tests__/climate-enforcer-service.test.ts
git commit -m "refactor(api): climate-enforcer onto DeviceStateStore"
git push
```

---

### Task 8: sonos-volume-enforcer + sonos-sound-system reads onto the store

**Files:**
- Modify: `api/src/services/sonos-volume-enforcer-service.ts`, `api/src/services/sonos-sound-system-service.ts`, `api/src/__tests__/sonos-volume-enforcer-service.test.ts`, `api/src/__tests__/sonos-sound-system-service.test.ts`

**Interfaces:** same pattern; enforcer cycle takes `store` param with default; sonos-sound-system's speaker read (`sonos-sound-system-service.ts:193`) becomes `store.list({ kind: DeviceKind.Speaker })`.

- [ ] **Step 1 (tests first):** delete `SelectChain` (89-105) + insert builder (113-122) + `vi.mock` (line 20) from the enforcer suite; in-memory store seeding instead. Run: FAIL.
- [ ] **Step 2:** Enforcer writes: seed INSERT (~184, the onConflict upsert) → `store.seed(...)`; unavailable (~213) / adopt (~239) / push (~253) / noop (~279, 286) → `store.writeReported(...)` with the same field mapping as Task 6. Reader at ~171 → `store.list({ kind: DeviceKind.Speaker })`. Its `upsertDesired` call already goes through the store since Task 5. Same parity check as Task 7.
- [ ] **Step 3: Run** both suites + full api tests — PASS.
- [ ] **Step 4: Commit + push.**

```bash
git add api/src/services/sonos-volume-enforcer-service.ts api/src/services/sonos-sound-system-service.ts api/src/__tests__/sonos-volume-enforcer-service.test.ts api/src/__tests__/sonos-sound-system-service.test.ts
git commit -m "refactor(api): sonos enforcer + sound-system reads onto DeviceStateStore"
git push
```

---

### Task 9: device-sync + remaining readers onto the store

**Files:**
- Modify: `api/src/services/device-sync-service.ts`, `api/src/services/controls-service.ts`, `api/src/services/climate-service.ts`, `api/src/services/party-service.ts`, plus their test files (`grep -n "SelectChain\|vi.mock(\"../db" api/src/__tests__/device-sync*.test.ts api/src/__tests__/controls.test.ts api/src/__tests__/climate.test.ts` to find fakes)

**Interfaces:**
- Consumes: full store surface.
- Produces: `reconcile(snapshot, store)`, `sweepExpiredWindows(now, store)`, `runDeviceSyncCycle(store = deviceStateStore)`; no remaining `import { db }`-for-device-state anywhere outside `api/src/db/device-state-store.ts`.

- [ ] **Step 1 (tests first):** same fake-deletion + in-memory-store pattern for device-sync's suite. Run: FAIL.
- [ ] **Step 2: device-sync mapping** (all sites read against `api/src/services/device-sync-service.ts` as of Task 1's HEAD):
  - line 34 `db.select().from(deviceState)` → `store.list()`
  - lines 50-58 reported update → `store.writeReported({ id: device.id, reported, available, changed: reportedChanged, now })` — **this is the one caller of `changed`** (stamps reportedChangedAtUtc, verbatim parity with the `...(reportedChanged ? ... : {})` spread)
  - lines 67-70 converge-clear → `store.clearDesired(device.id)`
  - lines 77-93 sweep → `const expired = await store.listExpiredWindows(now)`; ownership filter (`ownerOf(device) !== DeviceOwner.DeviceSync`) STAYS in the service (HA-adjacent policy, not storage); clear via `store.clearDesired(device.id)`
- [ ] **Step 3: Readers.**
  - `controls-service.ts:223` list-all → `store.list()`; `:362, 406, 589` keyed reads → `store.read(...)` / `store.readByEntityId`-shaped needs: **check the actual keys** — if a site selects by entityId, use `store.list({ entityIds: [x] })` and take `[0] ?? null`, or extend the interface with `readByEntityId(entityId)` if ≥2 sites want it (add to contract suite + both adapters in the same commit).
  - `climate-service.ts:139-149 readClimateEffective` → `store.readEffective(CLIMATE_DEVICE_ID)` + `isClimateState` narrow (delete the local select+merge)
  - `climate-service.ts:236, 263` row reads → `store.read(CLIMATE_DEVICE_ID)`
  - `party-service.ts:206` list-all → `store.list()`
  - Services gain the trailing `store: DeviceStateStore = deviceStateStore` param ONLY where their tests inject; module-level default import is fine where tests don't touch device state.
- [ ] **Step 4: Run** all touched suites + full `cd api && bun run test` — PASS. Grep gate: `grep -rn "from(deviceState)" api/src --include="*.ts" | grep -v db/device-state-store` → empty (excepting `packages/core`).
- [ ] **Step 5: Commit + push; watch CI; curl panel 302.**

```bash
git add api/src/services api/src/__tests__
git commit -m "refactor(api): device-sync + all remaining readers onto DeviceStateStore"
git push
```

---

### Task 10: Cleanup, knip, docs

**Files:**
- Modify: `CODEBASE_OVERVIEW.md` (packages/core section), `docs/superpowers/plans/2026-07-21-consolidation-roadmap.md` (mark C1 done), delete `api/src/services/command-window.ts` shim if knip shows all imports moved to `@www/core` (otherwise leave)
- Test: full gates

- [ ] **Step 1:** `bun run knip` — chase every new orphan this track created (re-export shims whose consumers all migrated die now; shims still consumed stay).
- [ ] **Step 2:** Docs: add `packages/core` to `CODEBASE_OVERVIEW.md` (one paragraph: what it holds, the two-adapter seam, "services take the store as a param with the pg default"); tick C1 in the roadmap.
- [ ] **Step 3: Full gates:** root `bun run typecheck`, `cd api && bun run test`, `cd packages/core && bun run test`, `bun run lint`, `bun run knip`, drizzle no-drift re-check.
- [ ] **Step 4: Commit + push; watch CI; curl panel 302.**

```bash
git add CODEBASE_OVERVIEW.md docs/superpowers/plans/2026-07-21-consolidation-roadmap.md
git commit -m "docs(core): C1 device-state store landed; roadmap + overview current"
git push
```

---

## Self-Review Notes (author)

- Spec coverage: decision 10's four pieces (interface, pg adapter, in-memory adapter, default instance) = Tasks 2/3/3/3; "services take store as param" = Tasks 5-9; "absorbs 5 bypassing writers" = desired-state-store (5), light (6), climate (7), sonos (8), device-sync (9); "8 direct readers" = Tasks 6-9 readers; "4 enforcer suites drop SelectChain fakes" = Tasks 6/7/8/9; "owning the device_state table" = Task 1 schema move + Task 9 grep gate.
- Roadmap verbs map: readDesired/readEffective → `read`/`readEffective`; writeDesired → `upsertDesired`/`updateDesired`/`clearDesired`; writeReported → `writeReported`/`seed`. The split follows the real call-site shapes (two desired shapes documented in desired-state-store.ts:17-23).
- Known judgment calls delegated to implementers WITH guardrails: `readByEntityId` addition (Task 9, ≥2-site rule), pure-function closure of the merge move (Task 4 purity rule), column-parity STOP rule (Tasks 7/8).
