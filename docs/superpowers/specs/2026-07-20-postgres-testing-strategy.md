# Real-Postgres Integration Testing Strategy

Status: proposal for decision
Date: 2026-07-20
Scope: `products/control-center/api` DB-touching tests (the queue/reaper suite is the motivating case)

---

## 1. Current state (audit)

### 1.1 How the app connects

`products/control-center/api/src/db/index.ts` is nine lines:

```ts
export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

Key facts that shape everything below:

- The `pg.Pool` and drizzle client are **module-level singletons**, constructed at import time.
- `pg.Pool` is **lazy**: constructing it opens no socket; the first *query* checks out a connection. So importing `db/index` does not touch Postgres. A test can set `DATABASE_URL` before the module loads and the pool will connect to the test DB on first use.
- `DATABASE_URL` is resolved in `products/control-center/api/src/env.ts:12`: an explicit `DATABASE_URL` always wins ("local dev, tests, CI"), otherwise it is assembled from `POSTGRES_*` service env; default `postgresql://cc:cc@localhost:5432/controlcenter` (`env.ts:82`).
- Everything downstream (`queue.ts`, `job-worker.ts`, every service) imports the **same `db` singleton**. There is no DB dependency injection anywhere — the singleton is the only seam, and today tests replace it with `vi.mock("../db/index")`.

### 1.2 Migration / schema setup

- `products/control-center/api/drizzle.config.ts`: schema `./src/db/schema.ts`, migrations out `./src/db/migrations`, dialect `postgresql`.
- `products/control-center/api/src/db/migrate.ts`: `runMigrations()` calls drizzle-orm's `migrate(db, { migrationsFolder })`.
- **24 migration SQL files** in `src/db/migrations`.
- Scripts (`api/package.json`): `db:generate` (drizzle-kit generate), `db:migrate` (drizzle-kit migrate), `db:push`, `db:studio`.
- In **prod**, schema is applied by `runMigrations()` at server boot (`server.ts:38`); both API and workers run it so whichever starts first prepares the schema. Same migrator, same 24 files — so migrating a test DB with `migrate()` is exactly what prod does.
- Local dev applies schema via Tilt: `db-migrate` resource runs `bun run --cwd products/control-center/api db:migrate` against the docker-compose Postgres (`products/control-center/Tiltfile:48`).

### 1.3 Provisioning that already exists

- `products/control-center/docker-compose.yml` already defines a `postgres:16-alpine` service, user/pw `cc`/`cc`, db `controlcenter`, with a `pg_isready` healthcheck. **Local Postgres is already a solved problem** — Tilt brings it up for `bun run dev`.
- **CI has no Postgres.** The `test-unit` job (`.github/workflows/ci.yml:150`) runs `bun run test:unit` (= `vitest run`) on `ubuntu-latest` with **no `services:` block**. There is a `www-control-center-drizzle` image built for prod migrations, but nothing stands up Postgres for the test job.

### 1.4 Vitest setup

- Root `vitest.config.ts`: a `projects` array (api, web, worker, captive-portal ×2, packages ×3, infra). `maxWorkers: 4`, **`pool: "forks"`** (each worker is a separate OS process). Coverage reported, never gated.
- `products/control-center/api/vitest.config.ts`: `environment: "node"`, `setupFiles: ["src/__tests__/setup-logger.ts"]`. **No `globalSetup`, no per-worker DB wiring.**
- `setup-logger.ts` only seeds the `@www/logger` root so `getLogger()` doesn't throw.
- `pool: "forks"` + `maxWorkers: 4` is the parallelism model any DB strategy must fit: up to 4 concurrent worker processes, each running whole test files serially, plus this repo runs 8–10 concurrent Claude sessions (memory: `parallel-claude-sessions-push-main`) — so a naive shared fixed-name test DB across sessions would collide.

### 1.5 The existing mock pattern and what coverage is lost

**18 test files** in `api/src` do `vi.mock(".../db/index")`. The two motivating ones:

`__tests__/queue.test.ts` — mocks `db` with a fake whose `execute()` runs the drizzle `sql\`\`` fragment through a hand-written `sqlText()` walker that concatenates the `queryChunks`, then asserts on **substrings of the emitted SQL text**:
- `logContains("SKIP LOCKED")`, `logContains("run_after <= now()")` (the load-bearing predicate guarding 93 parked `youtube_ingest` rows — `queue.test.ts:185`), `logContains("done"/"failed"/"transient")` to infer which branch ran.
- The claim SELECT is faked: `if (text.includes("SKIP LOCKED")) return { rows: [claimedRow] }`. **No real row is locked, no real predicate is evaluated.**

`__tests__/job-worker.test.ts` — same `sqlText()` approach for `reapStaleJobs`; asserts the reaper UPDATE text contains `status = 'running'`, `'queued'`, `attempts >= max_attempts`, `'failed'`, `locked_at <`, and `360)` (the lease arithmetic). The `RETURNING attempts >= max_attempts AS exhausted` result is **hand-fed** via `dbMock.returningRows`.

**What these tests cannot catch** (they assert intent, not behaviour):
- A typo'd column name in the reaper UPDATE (`locked_at`, `attempts`, `max_attempts`) — the string matcher passes; only prod fails. This is the exact risk the team-lead named.
- Whether `run_after <= now()` actually excludes a future-dated row, or `FOR UPDATE SKIP LOCKED` actually gives single-flight under two concurrent claimers.
- Whether `make_interval(secs => …)` computes the right instant, whether `RETURNING attempts >= max_attempts AS exhausted` returns what the code destructures, whether the `CASE WHEN … THEN 'failed' ELSE 'queued'` branch matches the row.
- Backoff arithmetic against a real `now()` clock; the retry `run_after` landing in the future.

### 1.6 Postgres-specific behaviour a mock cannot model

Confirmed in the codebase, load-bearing, and invisible to the string-matching mocks:
- `FOR UPDATE SKIP LOCKED` single-flight claim — `jobs/queue.ts:108`.
- `make_interval(secs => …)`, `now()` arithmetic — `queue.ts:176`, `job-worker.ts:89`.
- `RETURNING <expression> AS alias` — `job-worker.ts:90`.
- `CASE WHEN` inside `UPDATE` — `job-worker.ts:82`.
- `ON CONFLICT` / jsonb / casts across services: `integration-heartbeat`, `asc-version-service`, `playlist-poller-service`, `desired-state-store`, `settings-service`, `device-settings-service`, `frontend-log-service`, `wake-photo-service`, `portal-repo`, and `trpc/routers/media.ts`.

---

## 2. Requirements

The four the user named, plus two derived:

1. **Fast.** No database spun up per test. Isolation must not cost a container or a `CREATE DATABASE` per test.
2. **Isolation between tests.** No test standing on another's rows; no ordering coupling; a failed test must not poison the next.
3. **Not flaky.** Deterministic under `pool: "forks"` (4 workers) and 8–10 concurrent Claude sessions. No shared-state races on a fixed DB name.
4. **Well-designed / maintainable.** Decide the shape up front; one obvious way to write a DB test.
5. **(Derived) Parity.** Local and CI run the *same* Postgres (same image, same schema path) so a green-local test means green-CI.
6. **(Derived) Graceful when Docker is absent.** A developer with Docker stopped must get a clear skip/error, never a confusing failure, and unit (mocked) tests must still run without a DB.

---

## 3. Options considered

### 3.1 Provisioning the Postgres process

| Option | Pros | Cons against this repo |
|---|---|---|
| **CI `services:` postgres + local docker-compose** (recommended) | docker-compose **already exists** and Tilt already uses it; `services:` block is a few lines, GH-hosted, health-gated; pin `postgres:16-alpine` in both → exact parity | Two declarations of "the test DB image" to keep in sync (mitigate: same tag in both) |
| **testcontainers** | Ephemeral, self-cleaning, one code path for local+CI | Adds a dependency (currently none: `grep` finds no testcontainers/pg-mem/pglite). Needs Docker running in CI *and* locally; when a dev's Docker/OrbStack is down (a real recurring event here — see the OrbStack watchdog in CI) tests hard-fail at container start instead of a clean skip. Container start cost per run. More moving parts than the repo needs given docker-compose is already there |
| **pg-mem / PGlite (in-process fake)** | No Docker at all | **Disqualified by §1.6**: neither faithfully implements `FOR UPDATE SKIP LOCKED` concurrency; PGlite is single-connection so cross-connection locking can't be tested. Using a fake to test the exact thing mocks already can't test defeats the purpose |

### 3.2 Applying the schema to the test DB

| Option | Verdict |
|---|---|
| **drizzle `migrate()` once per run, then TEMPLATE-clone per worker** (recommended) | Runs the *same* 24 migrations prod runs (max fidelity), but only **once** — then `CREATE DATABASE … TEMPLATE` is a cheap file copy, so per-worker DBs are near-free. Avoids re-running 24 migrations × 4 workers |
| `drizzle-kit push` per DB | Faster than replaying migrations but tests a *different* schema path than prod boot; risks masking a bad migration. Reject for parity |
| Raw SQL snapshot (`pg_dump` of the migrated schema) | Fastest to load, but a checked-in snapshot rots against `schema.ts`/migrations and needs its own guard. Reject unless template-clone proves too slow (it won't) |

### 3.3 Isolation between tests — the crux

The requirement "isolation without per-test DB" means transaction-per-test rollback. But this codebase has two properties that make the textbook version non-trivial:

- **The code uses the `db` singleton**, not an injected client. A test's `BEGIN…ROLLBACK` on its *own* connection would not wrap writes the code issues on the *pool's* connection. Rollback would undo nothing.
- **The queue opens its own transaction** (`db.transaction(async tx => … SKIP LOCKED …)`, `queue.ts:95`) and then issues the post-handler `UPDATE`s on the bare `db` (not `tx`) — `queue.ts:152`. So the harness must cover both the code's own transaction *and* subsequent pooled statements.

Options:

**A. Single-shared-connection rollback (recommended default).**
Back the test `db` with a pool that hands **every** checkout the *same* physical connection, held open in a `BEGIN`. Then:
- Code's `db.execute(...)` runs on that connection, inside the outer transaction.
- Code's `db.transaction(...)` becomes a **nested** transaction → drizzle-orm (node-postgres) emits `SAVEPOINT`/`RELEASE`, not a real COMMIT. So the queue's self-managed transaction works unchanged, and its "commit" is a savepoint release that the outer `ROLLBACK` still undoes.
- `afterEach` → `ROLLBACK`. No writes ever persist; **no truncation, no DDL per test → fast**, and a failed test cannot poison the next.
- *Limitation (important):* one physical connection cannot exercise real cross-connection concurrency. `FOR UPDATE SKIP LOCKED` single-flight *between two competing claimers* cannot be proven here — a second claimer would need a second connection. This is the one thing transaction-rollback structurally cannot test, and it happens to be one of the things mocks also can't test (§1.6). See option C.

**B. One DB per worker + `TRUNCATE` between tests.**
Each worker (`VITEST_WORKER_ID` / `VITEST_POOL_ID`) gets its own template-cloned DB; `afterEach` truncates the touched tables. Uses the real pool with real concurrency. Slower than rollback (truncate is a write + WAL per test) and requires every test to know which tables to clear (poison risk if one forgets). Good fallback where rollback can't apply.

**C. Per-worker DB, no rollback, real multiple connections — reserved for concurrency semantics.**
A small, explicitly separate category for the handful of tests that must prove `SKIP LOCKED` single-flight, lock contention, etc. These open 2+ real pool connections, race real claims, and clean up by `TRUNCATE`/rollback of a dedicated table. Kept few and clearly named so their cost/complexity doesn't spread.

**D. One DB per test (`CREATE DATABASE` per test).** Explicitly rejected by the user (slow) and by requirement 1. Template DBs make per-*worker* creation cheap; per-*test* is still DDL-per-test.

### 3.4 Injecting the test connection through the existing seam

The 18 files already `vi.mock("../db/index")`. The elegant migration is to **keep that seam but back it with a real, transaction-scoped drizzle** instead of a fake. Concretely, a `test-db` helper module:
- `globalSetup`: ensure the base DB is migrated once; create this worker's DB via TEMPLATE.
- `beforeEach`: check out the single shared connection, `BEGIN`, build `drizzle(clientBoundToThatConn, { schema })`, store it in a module-level holder.
- The `vi.mock("../db/index")` factory returns a `db` proxy that forwards to the current holder.
- `afterEach`: `ROLLBACK`, release.

This means porting a file from "fake db" to "real db" is swapping the mock factory for the shared helper — the call sites don't change.

---

## 4. Recommendation

A single coherent strategy:

**Provisioning.** Local: the existing `products/control-center/docker-compose.yml` `postgres:16-alpine` (already wired into Tilt). CI: add a `services: postgres` block to the `test-unit` job using the **same** `postgres:16-alpine` tag, health-gated, exporting `DATABASE_URL` for the job. Same image both places = parity. No new dependency; testcontainers rejected for the Docker-down friction this repo actually hits.

**Schema.** A vitest `globalSetup` (new, for the api project) migrates a base template DB **once per run** with the real `migrate()` + the 24 migration files, then each worker `CREATE DATABASE test_w${VITEST_WORKER_ID} TEMPLATE base` — cheap clone, no migration replay per worker.

**Isolation.** Transaction-per-test rollback via the **single-shared-connection** pattern (§3.3A), injected through the existing `vi.mock("../db/index")` seam backed by a `test-db` helper (§3.4). The queue's self-managed `db.transaction()` composes correctly because nested transactions become **savepoints** under node-postgres/drizzle, and the post-handler pooled `db.execute` statements land on the same held connection inside the same outer transaction. No per-test DDL, no truncation → fast; `ROLLBACK` guarantees isolation and failed-test containment.

**Parallelism.** One DB per vitest worker (bounded by `maxWorkers: 4`), transaction rollback per test within it. Because each worker's DB name is derived from `VITEST_WORKER_ID`, concurrent Claude sessions each running vitest still collide only if they share a Postgres *and* a worker id — so name the DB with a per-run salt (run id / pid) in addition to the worker id, or point each session's docker-compose at its own Postgres. (Open question 6.3.)

**Concurrency-semantics tests** (real `SKIP LOCKED` single-flight) are the one carve-out: a small named category (`*.concurrency.pg.test.ts` or similar) that opts out of shared-connection rollback, opens multiple real connections against the per-worker DB, and cleans up by truncating its own table. This is deliberately the *only* place the two-connection cost is paid.

**Graceful absence.** The api `globalSetup` probes the DB; if unreachable it fails the **pg project** with a one-line "start docker-compose Postgres" message, while the mocked unit tests (a separate concern) still run. In CI the `services:` block guarantees presence, so a missing DB in CI is a hard error, not a skip.

Why this over the alternatives, in one line each: rollback beats truncate on speed (req 1) and poison-safety (req 2); single-shared-connection is the only rollback variant that works with a `db` **singleton** the code won't let us inject per call; template-clone beats re-migrating per worker on speed; `services:`+compose beats testcontainers on this repo's Docker-down reality and adds no dependency; the concurrency carve-out honestly quarantines the one thing rollback can't do rather than pretending it can.

---

## 5. Migration path

1. **Land the harness first, prove it on the motivating suite.** Build the `test-db` helper, the api `globalSetup` (migrate base + template-clone per worker), and the CI `services:` block. Port `queue.test.ts` and `job-worker.test.ts` to the real `db`. These stop asserting SQL substrings and start asserting **rows**: insert a future-`run_after` job and assert `claimOne` skips it; run the reaper against a real stranded `running` row and assert the row's status/columns flip (this is what catches the reaper column typo). Add one `*.concurrency.pg.test.ts` that races two `claimOne` calls and asserts exactly one wins.
2. **Coexistence during transition.** Real-PG tests live in a **separate vitest project** (e.g. `api-pg`) with its own `globalSetup`; the existing mocked `api` project is untouched. Both run in the same `vitest run`. A test file is either mocked-fake-db or real-db, never both — no half-migrated files. This avoids a big-bang rewrite: port file by file, deleting the `sqlText()` string-match assertions only once the real assertions cover the same intent.
3. **Order by value.** After the queue/reaper: the services with real SQL that mocks can't vouch for — `desired-state-store`, `integration-heartbeat`, `settings-service`/`device-settings-service` (ON CONFLICT upserts), `playlist-poller-service`, `frontend-log-service`, `wake-photo-service`. Pure-logic tests (enforcers that mock the DB only to avoid a connection, asserting on service logic not SQL) can stay mocked — porting them buys little.
4. **Retire the `sqlText()` walkers** once no test depends on them.

---

## 6. Risks / open questions

**6.1 (Biggest) The single thing neither mocks nor rollback can test.** `FOR UPDATE SKIP LOCKED` single-flight is the queue's core correctness property, and transaction-rollback (one connection) structurally cannot exercise it. The recommendation puts it in a separate two-connection carve-out (§3.3C) — but that category doesn't get transaction-rollback isolation, so it needs its own cleanup and is the most likely source of any future flake. **Decision for the user:** accept the small non-rollback concurrency category as the home for these few tests, or invest instead in a fully connection-per-test real-transaction harness (option B everywhere: real concurrency, but truncate-based, slower, poison-risk if a test forgets a table)? The recommendation is the carve-out; it keeps 95% of tests on the fast rollback path.

**6.2 Nested-transaction savepoint assumption.** The whole rollback approach relies on drizzle-orm `0.45.2` (node-postgres) emitting `SAVEPOINT` for a `db.transaction()` nested inside the harness's `BEGIN`, and on the single-shared-connection pool actually returning one connection to all checkouts. Both are standard, but **must be proven with a spike** (one test: harness `BEGIN` → call `claimOne` which opens its own tx → assert the claim is visible mid-test and gone after `ROLLBACK`) before porting 18 files. If it doesn't hold, fall back to per-worker-DB + truncate (option B).

**6.3 Shared Postgres across 8–10 Claude sessions.** Per-worker DB names keyed only on `VITEST_WORKER_ID` collide if two sessions share one Postgres. Options: (a) each session's docker-compose binds its own Postgres port/volume (the Tiltfile already parameterises `POSTGRES_PORT`), or (b) salt the test DB name with run id/pid. Needs a decision on whether sessions share one local Postgres or get one each.

**6.4 `db` is a hard singleton with no DI.** The recommendation threads the test connection through `vi.mock`. A cleaner long-term seam is a `createDb(url)` factory in `db/index.ts` so tests inject without module mocking — a small, optional refactor. Worth doing if mock-based injection proves awkward across many files.

**6.5 CI cost.** A `services:` Postgres adds image-pull + boot to `test-unit` every run (including for changes that touch no DB code). Acceptable given the job already installs Playwright, but note it. Template-clone keeps the per-test cost near zero; the fixed cost is the container.

**6.6 Migration drift guard.** `globalSetup` migrating a fresh DB every run *is itself* a test that the 24 migrations apply cleanly from zero — a bonus. But if a migration is destructive/irreversible, the template approach still only ever runs it forward on a throwaway DB, so no prod risk.
