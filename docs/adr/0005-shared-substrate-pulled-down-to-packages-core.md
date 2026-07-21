# Genuinely shared substrate is pulled DOWN to `packages/core`, never shared sideways App→App

When two or more **independent** features write the same state, that state does not become an App's
table and it does not become an App→App dependency edge. It is pulled **down** into `packages/core`
as a typed store owned by no App. The test (Gap 1 of the App-construct design): *"would two
features fight over a write path if separated?"* If yes and they are genuinely one feature, they are
one App; if yes and they are independent features, the write path is shared substrate → `core`.

The load-bearing instance: `device_state` is written by Controls, Climate, **and** the device-sync
cycle — three independent writers. It becomes `packages/core/device-state/` exposing
`readDesired` / `writeDesired` / `readEffective`; the `deviceState` table is owned by core. (An
earlier `device_commands` in-flight-gate table this ADR originally cited no longer exists in the
schema — it was replaced by an in-memory adopt/absorb window; see the historical comment at
`light-enforcer-service.ts:121`.) Controls, Climate, and Schedules each import the store, and each still owns its own
Enforcer Cycle and its own router slice — but **none owns the device_state table.** The `job` queue
table, HA client, env, migrator, and logger move into core the same way, only as far as later Apps
need them. This is what dissolves the interim `worker-deps.ts` / `media.ts` barrels.

## Considered options

- **Typed core store (chosen).** A real shared seam with a concrete interface; the two-independent-
  writers test proves it is a foundation, not a leaf. Cost: `packages/core` is a genuine new
  workspace (touches `bun.lock` and all full-install Dockerfile `COPY` lists).
- **Make it an App's table, other Apps import the symbol (rejected).** Forces a false ownership — no
  single device feature owns `device_state`; readers reaching into another App's schema re-creates
  the scattering the App construct exists to remove.
- **App→App `dependsOn` edge (rejected).** Lint-only and rots; it encodes a runtime coupling the
  type system does not carry. A typed store is strictly deeper.

## Why it is recorded

Hard to reverse — creating `packages/core`, moving table ownership, and repointing three device Apps
is a real workspace + schema migration. Surprising without context — a reader designing the device
Apps will ask "where does `device_state` live?" and expect it inside a device App; that it is owned
by no App, in core, is the non-obvious boundary. A real trade-off — App ownership vs. `dependsOn`
edge vs. a pulled-down core store, decided by the two-adapters/two-writers test.
