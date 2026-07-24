# Unit S2 — Cron-run seam + migrate guest-wifi's purge (first consumer)

> Track C, Phase 2 / Wave 4. Roadmap `~/.claude/plans/merry-hugging-river.md` §S2;
> master plan `docs/superpowers/plans/2026-07-23-track-c-master-execution.md`
> (Wave 4 + the "S2 cron runtime shape" PLACEHOLDER). This plan is for the
> IMPLEMENTER; a separate agent executes it. Do not re-litigate the roadmap's
> locked decisions. Mirror the JUST-LANDED S1 worker-job seam pattern
> (`docs/superpowers/plans/units/2026-07-23-S1-worker-job-seam.md`): a branded
> facet, collected by `scripts/apps-gen/collect.ts`, emitted to a
> `features/_generated/*.gen.ts`, consumed by a generic runtime iterator.

## What this unit builds

The generic cron-run seam every future purge-bearing feature inherits, then
proves it end-to-end by migrating `guest-wifi`'s portal purge onto it as the
first consumer.

Today: `features/_generated/crons.gen.ts` is EMITTED (a `{name, schedule, source}`
data listing collected from each feature's `defineCron` facet) but has **no
runtime consumer**. Guest-wifi's purge runs only via the hand-wired
`apps/api/src/purge.ts` (bundled to `purge.js`) + a hardcoded `portal-data-purge`
block in `infra/src/crons.ts` that runs `bun purge.js`. After S2: a feature
declares `defineCron` in its `jobs.ts`, codegen collects it, `infra/src/crons.ts`
iterates `GENERATED_CRONS` and emits one k8s CronJob per entry running a single
generic dispatch entrypoint (`bun cron.js <name>`), and the entrypoint looks the
cron up in a generated handler barrel and invokes its `run()`. Zero per-cron
hand-wiring for new purges.

---

## Ground truth (verified this session — do not re-derive)

- **`crons.gen.ts` is a pure DATA listing** (`{name, schedule, source}[]`,
  `GENERATED_CRONS`), rendered by `renderCrons` (`scripts/apps-gen/emit.ts:184`).
  It IS in the `apps:check` drift set (`scripts/apps-check.ts:68` `crons.gen.ts`).
  Its only current entry is `{ name: "portal-data-purge", schedule: "0 2 * * *",
  source: "feature:guest-wifi" }`.
- **`jobs.gen.ts` is a HANDLER barrel** (`renderJobs`, `emit.ts:159`) — imports
  each feature's `jobs` facet and spreads them into `GENERATED_JOBS`. It is **NOT**
  in the `apps:check` drift set (verified — only tiles/router/guest-router/schema/
  crons are). Its correctness is caught by `typecheck` + the S1 worker-seam test.
  **Mirror this exactly for the new cron handler barrel.**
- **The cron facet brand ALREADY EXISTS.** `app-kit/define-facets.ts:5,20` declares
  `CRON_BRAND` + `defineCron(spec: CronSpec)` where
  `CronSpec = { name: string; schedule: string; run: () => Promise<void> }`.
  `collect.ts:157` already collects `CRON_BRAND`-branded exports into `crons`. So
  **no brand must be added.** What is missing is: (a) the handler-barrel emission,
  (b) capturing the export identifier + feature dir so the barrel can import the
  facet, (c) the generic runtime entrypoint, (d) the infra iteration.
- **`collect.ts` cron collection** (`:154-160`) iterates `Object.values(jobsMod)`
  and pushes `{ name, schedule, source }` per branded cron. It does NOT capture the
  export NAME or feature `dir` — both are needed by the handler barrel to emit a
  static named import. (`Object.entries` gives the export identifier.)
- **`apps/api/src/purge.ts`** (bundled to `purge.js`, `apps/api/Dockerfile:61`
  `cd apps/api && bun build src/purge.ts --outfile ../../dist/purge.js`) runs **five**
  purges in one process: portal (guest-wifi, via `@features/guest-wifi/jobs`
  `purgePortalData` on the guest-wifi db), weather, frontend-logs, wake-photos,
  github. **Only the portal purge is a `defineCron` facet today**; the other four
  belong to features that fold LATER (weather=Wave 7, felogs=Wave 7, wakes=Wave 5,
  deploys=Wave 2). **This is the key constraint: S2 can migrate ONLY the portal
  purge; `purge.ts` must survive (running the other four) until those features
  fold.** The master plan's "`apps/api/src/purge.ts` is removed" end-state is only
  reachable at the END of Track C — see PLACEHOLDER-1.
- **`infra/src/crons.ts`** is k8s-native. `cronSpecs(nasNfsServer)` (`:100`) returns
  hand-authored `OwnedCronJobSpec[]`: the `portal-data-purge` block (`:110-122`,
  `image: ghcr("api")`, `command: ["bun", "purge.js"]`, `schedule: "0 2 * * *"`,
  `secrets: [POSTGRES_PASSWORD]`, `secretName: SERVICE_SECRET_TARGETS["portal-data-purge"].secretName`,
  `env: { TZ, POSTGRES_HOST }`, `imagePullSecrets: [GHCR_PULL_SECRET_NAME]`),
  `map-extract`, and the pg-backup. `deployCrons` (`:169`) maps each spec to a
  `ScheduledJob` (`infra/src/component.ts:601` — renders a one-shot k8s CronJob:
  `concurrencyPolicy: Forbid`, `restartPolicy: Never`). Consumed by
  `infra/program.ts:123`.
- **`ScheduledJob` semantics = one-shot.** `renderCronJob` (`component.ts:456`)
  emits `concurrencyPolicy: "Forbid"`, `restartPolicy: "Never"`,
  `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 1`. This is exactly the
  one-shot batch semantics the recommended shape (below) relies on.
- **Biome dep boundaries** (`biome.json`): the `noRestrictedImports` rules ban
  `features → apps/api`, `app-kit → features`, `packages/{core,platform} → {app-kit,
  features}`. **There is NO rule against `infra → features`** — infra importing
  `features/_generated/crons.gen` is allowed. (Also confirmed: `apps/api → @features`
  is allowed; `purge.ts` already imports `@features/guest-wifi/*`.)
- **`apps/api` resolves `@features`** in its Docker bundle (`Dockerfile:52` mirrors
  `cd apps/api && bun build …`). The new `cron.js` bundle inherits that.

---

## Resolved decisions

### D1 — Cron runtime shape: **k8s CronJob (one-shot pods), seam-driven. NOT worker-interval.**

This resolves the master-plan PLACEHOLDER. The generic `crons.gen.ts` consumer is
**a single generic dispatch entrypoint bundled into the api image and run as a
one-shot k8s CronJob per `GENERATED_CRONS` entry** — NOT a long-running interval
inside `apps/worker`.

Justification:
- **The codebase already made this decision and codified it.** `purge.ts`'s
  docstring: "runs it once a day as a one-shot job … NOT a worker loop (PRD Backend
  rule 7), the scheduler owns the cadence." `AGENTS.md`: "Cron jobs live in
  `infra/src/crons.ts`." S2 keeps that model and makes it *generated*, rather than
  inventing a second, contradictory cron runtime.
- **Every Track-C cron is a daily/hourly batch PURGE** (portal/weather/github/
  frontend-log/wake/booth — roadmap S2 + Wave 7). One-shot pods give clean failure
  isolation the `ScheduledJob` component already provides: `restartPolicy: Never`,
  non-zero exit = the Job is recorded failed, `failedJobsHistoryLimit` for
  post-mortem — none of which an always-on interval offers. A heavy batch delete
  running inside the worker also mixes with the 1s reconcile loops.
- **k8s CronJob's 1-minute minimum granularity is ample** for purges (all daily).
  (This is why intervals — enforcers 1s, weight-ingest 15s — can NEVER be S2 crons;
  they stay hand-wired in `apps/worker`, per the master plan "Interval cycles are
  NOT a seam". S2 is for real schedules ≥1 min only.)
- **`infra/src/crons.ts` stays the source of the k8s wiring**, exactly as AGENTS.md
  says — the seam just replaces its hand-authored purge block with a loop over
  `GENERATED_CRONS`. The seam is the codegen edge (feature `defineCron` → collect →
  `crons.gen.ts` → infra iterates), not a new process type.

**One entrypoint, N CronJobs.** The generic entrypoint dispatches by name
(`bun cron.js <name>`); infra emits one CronJob per `GENERATED_CRONS` entry, each
passing its own name. This scales to 10–100 crons with zero new entrypoints or
images (the design-for-10x invariant) — the opposite of one hand-wired bundle +
block per cron.

### D2 — Two generated files: keep `crons.gen.ts` (data, for infra) + add `cron-handlers.gen.ts` (handler barrel, for the runtime)

The seam has two consumers with irreconcilable needs:
1. **`infra/src/crons.ts`** needs `{name, schedule}` DATA to emit k8s CronJobs, and
   **must not import feature runtime** (a Pulumi program pulling live feature/db
   code is wrong, and infra is a separate workspace).
2. **the generic entrypoint** needs `{name → run()}` HANDLERS to execute the due
   cron — feature runtime, only importable from the api image (which MAY import
   `@features`).

So they must be separate files — the same reason S1 keeps `tiles.gen.ts` (data)
separate from `jobs.gen.ts` (handlers):
- **`features/_generated/crons.gen.ts`** — UNCHANGED shape (`GENERATED_CRONS`,
  `{name, schedule, source}`). `renderCrons` stays byte-identical (it reads only
  name/schedule/source), so it stays in `apps:check` drift with no churn.
  **Consumed by `infra/src/crons.ts`** via a relative import.
- **`features/_generated/cron-handlers.gen.ts`** — NEW handler barrel (mirror
  `jobs.gen.ts`): named imports of each feature's cron facet + a `CRON_HANDLERS:
  Record<string, () => Promise<void>>` name→run map. **NOT** in `apps:check` drift
  (mirror `jobs.gen.ts`); typecheck + the seam test cover it. **Consumed by the
  generic entrypoint.**

### D3 — Capture the export identifier in `collect.ts` so the barrel can emit a static import

`renderCronHandlers` must emit `import { purgeCron } from "../guest-wifi/jobs"`,
which needs the facet's EXPORT NAME (`purgeCron`) and feature `dir` (`guest-wifi`).
`collect.ts` currently pushes only `{name, schedule, source}`. Change the cron
branch to iterate `Object.entries(jobsMod)` (not `Object.values`) and record the
export identifier + dir on `CollectedCron`:

```ts
interface CollectedCron {
  name: string;        // the cron's runtime name ("portal-data-purge")
  schedule: string;
  source: string;      // "feature:guest-wifi" — unchanged, keeps crons.gen.ts data stable
  dir: string;         // NEW: feature folder, for the relative import
  exportName: string;  // NEW: the exported identifier of the defineCron facet
}
```

`renderCrons` ignores `dir`/`exportName` (crons.gen.ts stays byte-identical).
`renderCronHandlers` uses them. This keeps the barrel fully STATIC (named imports),
mirroring `renderRouter`/`renderJobs` — no runtime brand-scan in generated code.

### D4 — Generic entrypoint: `apps/api/src/cron-run.ts`, bundled to `cron.js`

Lives beside `purge.ts` (apps/api owns the image that bundles cron entrypoints and
MAY import `@features`). Exports a testable `runCron(name)`; the top-level guard
dispatches `process.argv[2]` and force-exits (a one-shot must terminate even though
each feature's db pool is process-lifetime and never explicitly closed here — the
delete already awaited, exit reclaims the pool; mirror `purge.ts`'s explicit
`process.exit(1)` on failure):

```ts
// apps/api/src/cron-run.ts
import { CRON_HANDLERS } from "@features/_generated/cron-handlers.gen";
import { createLogger } from "@www/logger";

const log = createLogger({ service: "cron" });

/** @public — invoked by the top-level guard AND the seam test. */
export async function runCron(name: string | undefined): Promise<void> {
  if (!name) throw new Error("cron-run: no cron name given (usage: bun cron.js <name>)");
  const handler = CRON_HANDLERS[name];
  if (!handler) {
    throw new Error(`cron-run: unknown cron '${name}' (known: ${Object.keys(CRON_HANDLERS).join(", ")})`);
  }
  await handler();
  log.info({ cron: name }, "cron complete");
}

// import.meta.main guards the dispatch so importing this file in a test is inert.
if (import.meta.main) {
  try {
    await runCron(process.argv[2]);
    process.exit(0);
  } catch (err) {
    log.error({ err, cron: process.argv[2] }, "cron failed");
    process.exit(1);
  }
}
```

(Confirm `import.meta.main` is the right bun guard here — `purge.ts` runs
unconditionally at top level; the new entrypoint must be import-safe for the test.
If `import.meta.main` is unavailable under the test runner, split the dispatch into
a tiny separate `cron-run.entry.ts` that only calls `runCron` and is the Docker
bundle target, leaving `cron-run.ts` a pure module.)

### D5 — First consumer: rename guest-wifi's facet to `guest-wifi-purge`; keep the legacy `portal-data-purge` CronJob running `purge.js`

Because `purge.ts` must keep running the OTHER four purges (their features are not
folded), the least-disruptive migration is:

- **Rename the guest-wifi cron facet name** from `"portal-data-purge"` to
  `"guest-wifi-purge"` (`features/guest-wifi/jobs.ts:76`). This is also more
  correct — it is the guest-wifi feature's purge.
- **The seam emits a NEW k8s CronJob `guest-wifi-purge`** running `bun cron.js
  guest-wifi-purge` → invokes `purgeCron.run` → `purgePortalData(guest-wifi db)`.
  Brand-new Pulumi object; nothing orphaned.
- **The legacy `portal-data-purge` CronJob block stays** in `infra/src/crons.ts`
  UNCHANGED, still running `bun purge.js` — but `purge.ts` now runs only weather/
  frontend-log/wake/github (the portal purge is removed from it). The existing k8s
  `portal-data-purge` object is preserved (no rename, no orphan), matching the
  comments' obsession with not orphaning it.
- **No new ESO secret.** The `guest-wifi-purge` CronJob mounts the SAME
  `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName` — both jobs need only
  `POSTGRES_PASSWORD`, and a k8s Secret can be mounted by any pod in the namespace.
  (Verify `secrets-map.ts` / `eso.ts` don't assert a 1:1 job-name↔target coupling;
  if they do, add a `guest-wifi-purge` target — see gotchas.)

Alternative rejected: renaming the legacy purge job instead would delete+recreate
the existing `portal-data-purge` k8s object (Pulumi replace), which the crons.ts
comments explicitly warn against ("keep the name … so the existing object isn't
orphaned"). Renaming the guest-wifi facet touches no existing object.

### D6 — Two commits (seam machinery inert, then first consumer)

Mirror S1's split.

1. **`feat(cron): generic cron-run seam over crons.gen.ts + cron.js dispatch (S2)`**
   — capture export-id/dir in collect, add `renderCronHandlers` + emit
   `cron-handlers.gen.ts`, add `apps/api/src/cron-run.ts`, bundle `cron.js` in the
   Dockerfile, add the seam test. **No infra change, no `purge.ts` change, no facet
   rename.** `crons.gen.ts` is byte-identical (still `portal-data-purge`). Ships
   green: `cron.js` exists in the image, unused in prod. Reviewable in isolation as
   "the seam".
2. **`feat(guest-wifi): migrate portal purge onto the S2 cron seam`** — rename the
   facet to `guest-wifi-purge`, remove the portal purge from `purge.ts`, iterate
   `GENERATED_CRONS` in `infra/src/crons.ts` to emit the `guest-wifi-purge` CronJob,
   regen both `.gen.ts`, update the infra + guest-wifi tests. **This flips the
   prod cron path and needs an infra deploy** (see Infra implications). Proves the
   seam.

Rationale: commit 1 is generic infra with no behaviour change; commit 2 is the
first consumer that proves it end-to-end. Cannot be one commit cleanly, because
iterating `GENERATED_CRONS` while the hand-wired `portal-data-purge` block still
carries that name would collide in Pulumi (D5 renames the facet precisely to avoid
this) — the rename + infra flip are one atomic behavioural change, distinct from
the inert machinery.

---

## Commit 1 — the seam (generic infra, no behaviour change)

### 1a. Capture export id + dir in `collect.ts`

`scripts/apps-gen/collect.ts`:
- Add `dir` + `exportName` to `CollectedCron` (§D3).
- In the `jobs.ts` scan (`:155`), iterate `Object.entries(jobsMod)`; for each
  `CRON_BRAND`-branded value push
  `{ name, schedule, source: \`feature:${dir}\`, dir, exportName }`. (The JOBS facet
  branch is unchanged — it stays on the same loop; a `jobs.ts` may export both.)
- `crons.gen.ts` (data) is unaffected — `renderCrons` reads only name/schedule/
  source, so `bun run apps:gen` produces a byte-identical `crons.gen.ts`.

### 1b. Emit `cron-handlers.gen.ts`

`scripts/apps-gen/emit.ts` — add `renderCronHandlers(model)`, mirroring
`renderJobs` (named imports + a static map, NOT a data listing):

```ts
/**
 * The generated cron handler barrel (S2). Unlike renderCrons (a data-only listing
 * consumed by infra/src/crons.ts to emit k8s CronJobs), this emits REAL imports of
 * each feature's defineCron facet and a name -> run() map, consumed by the generic
 * cron-run entrypoint (apps/api/src/cron-run.ts, bundled to cron.js). One entrypoint
 * dispatches every collected cron by name; zero per-cron hand-wiring.
 */
export function renderCronHandlers(model: AppModel): string {
  const crons = [...model.crons].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (crons.length === 0) {
    return `${GEN_HEADER}

export const CRON_HANDLERS: Record<string, () => Promise<void>> = {};
`;
  }
  // Alias each import by dir+exportName to avoid collisions across features.
  const imports = crons
    .map((c) => `import { ${c.exportName} as ${ident(c.dir)}_${c.exportName} } from "../${c.dir}/jobs";`)
    .join("\n");
  const entries = crons
    .map((c) => `  ${JSON.stringify(c.name)}: ${ident(c.dir)}_${c.exportName}.run,`)
    .join("\n");
  return `${GEN_HEADER}

${imports}

export const CRON_HANDLERS: Record<string, () => Promise<void>> = {
${entries}
};
`;
}
```

(Two features exporting the SAME identifier are disambiguated by the `dir_` alias
prefix. If a feature ever exports two crons with the same identifier that is
impossible — export names are unique per module.)

### 1c. Wire the emitter into `apps:gen`

`scripts/apps-gen.ts` `main()`: add
`writeFileSync(join(GEN_DIR, "cron-handlers.gen.ts"), renderCronHandlers(model));`
and import `renderCronHandlers`. Run `bun run apps:gen` to create the initial
committed `features/_generated/cron-handlers.gen.ts` (it will contain the
`portal-data-purge` → `purgeCron.run` entry, since the facet still exists).

**Do NOT add `cron-handlers.gen.ts` to `scripts/apps-check.ts` AGGREGATES** —
mirror `jobs.gen.ts`, which is deliberately excluded (a handler barrel importing
feature runtime is not a candidate for the string-diff drift check; typecheck +
the seam test cover it). `crons.gen.ts` stays in AGGREGATES unchanged.

### 1d. Validate (optional dup check)

`scripts/apps-gen/validate.ts` already has no cron-specific check. Add a
**duplicate cron-name** check across features (mirror the dup-job-type check at
`:89-101`): two features declaring the same cron `name` would collide as one k8s
CronJob object AND overwrite each other in `CRON_HANDLERS`. Add to the `Model`
type `crons?: { name: string; source: string }[]` and throw `CodegenError` on a
dup name. (Low-cost safety; the seam only has one cron today.)

### 1e. Generic entrypoint + Docker bundle

- New `apps/api/src/cron-run.ts` (§D4).
- `apps/api/Dockerfile`: add a bundle step mirroring the `purge.js` line (`:61`):
  ```
  RUN cd apps/api && bun build src/cron-run.ts --target=bun --outfile ../../dist/cron.js
  ```
  and COPY it into the runtime stage beside `purge.js` (`Dockerfile:80`):
  ```
  COPY --from=build /app/dist/cron.js cron.js
  ```
  `cd apps/api` is MANDATORY — `bun build` reads the CWD tsconfig `paths` to resolve
  `@features`; the repo-root tsconfig is paths-free (memory
  `bun-build-alias-needs-cwd-tsconfig`; local typecheck passes even if wrong, fails
  CI-only). Verify the `@features/_generated/cron-handlers.gen` import resolves in
  the bundle (the S1 `jobs.gen` import proved `@features` resolves from
  `apps/api`/`apps/worker`).

### 1f. Seam test (commit 1 level — proves dispatch, not just emission)

New `apps/api/src/__tests__/cron-run.test.ts` (and/or extend
`scripts/apps-gen/collect.test.ts` / `emit.test.ts`). Two levels, mirroring the S1
worker-seam test:
1. **Codegen level:** assert `collect()` picks up the guest-wifi cron with
   `name === "portal-data-purge"` (commit 1) / correct `schedule`, `dir`,
   `exportName`; assert `renderCronHandlers(model)` emits an
   `import { purgeCron as guestWifi_purgeCron } from "../guest-wifi/jobs"` line and a
   `"portal-data-purge": guestWifi_purgeCron.run` entry.
2. **Runtime dispatch level (the real proof):** import `runCron` from
   `apps/api/src/cron-run.ts`; mock `@features/guest-wifi/db` (and/or
   `@features/guest-wifi/jobs`'s `purgePortalData`) so no real DB is touched;
   call `runCron("portal-data-purge")`; assert the purge path ran (e.g. the mocked
   `db.delete(...).where(...)` was invoked, or `purgePortalData` was called). This
   proves the collected cron actually RUNS through the generated barrel + generic
   dispatcher — not merely that a name is present. Confirm the vitest project that
   owns `apps/api/**` resolves `@features` at runtime (esbuild alias, not tsc —
   mirror how the S1 worker-seam test resolved `@features/_generated/jobs.gen`).

### Commit-1 verify

`bun run apps:gen` (byte-identical `crons.gen.ts`; new `cron-handlers.gen.ts`) →
`bun run typecheck` → `bunx vitest run apps/api scripts/apps-gen` (incl. the new
seam test) → `bun run apps:check` (crons.gen.ts NOT drifted;
`cron-handlers.gen.ts` correctly ABSENT from the check) → `bun run knip` (the new
`cron-run.ts` + `renderCronHandlers` + `CRON_HANDLERS` must all be reachable —
`cron-run.ts` is a Docker entrypoint like `purge.ts`; confirm knip treats it as an
entry, mirror how `purge.ts` is whitelisted in `knip` config — **verify
`purge.ts`'s knip entry treatment and replicate for `cron-run.ts`, else knip goes
red on an "unused" entrypoint**) → `bun run lint`. Commit + push + watch CI.

---

## Commit 2 — migrate guest-wifi's portal purge (first consumer, proves the seam)

### 2a. Rename the facet

`features/guest-wifi/jobs.ts:76`: change `defineCron({ name: "portal-data-purge",
… })` to `name: "guest-wifi-purge"`. Update the docstring (it currently says the
scheduling "still lives in infra/src/crons.ts as the portal-data-purge k8s
CronJob … no runtime consumer yet" — that is now false; rewrite to: this facet IS
the runtime source, collected into `crons.gen.ts` + `cron-handlers.gen.ts`, run by
the `guest-wifi-purge` k8s CronJob via `bun cron.js guest-wifi-purge`).

### 2b. Remove the portal purge from `purge.ts`

`apps/api/src/purge.ts`: delete the `import { db as guestWifiDb, pool as
guestWifiPool } from "@features/guest-wifi/db"` and `import { purgePortalData } from
"@features/guest-wifi/jobs"` lines (`:21-22`); delete the `const portal = await
purgePortalData(guestWifiDb)` line (`:35`) and the `...portal` spread in the log
(`:42`); delete both `guestWifiPool.end()` calls (`:61`, `:65`). Update the
docstring's bullet list (drop "portal: authorizations …"). `purge.js` now runs
weather/frontend-log/wake/github only. (Its `portal-data-purge` CronJob name is now
a misnomer — acceptable interim; it dies when the last of the four features folds.
See PLACEHOLDER-1.)

knip: `purgePortalData` stays used (by `purgeCron.run` inside `guest-wifi/jobs.ts`);
`guestWifiDb`/`guestWifiPool` are no longer imported by `purge.ts` but remain the
guest-wifi feature's own db handles — no dead export.

### 2c. Iterate `GENERATED_CRONS` in `infra/src/crons.ts`

Add a generated-cron mapper and spread it into `cronSpecs()`:

```ts
import { GENERATED_CRONS } from "../../features/_generated/crons.gen";

// One k8s CronJob per collected defineCron facet (S2 seam). Each runs the api
// image's generic cron dispatcher (`bun cron.js <name>`), which invokes the
// feature's run() via cron-handlers.gen.ts. Replaces per-cron hand-wiring: a new
// purge-bearing feature declares defineCron and appears here automatically.
function generatedCronSpecs(): OwnedCronJobSpec[] {
  return GENERATED_CRONS.map((c) => ({
    name: c.name,
    namespaceName: "control-center",
    image: ghcr("api"),
    schedule: c.schedule,
    command: ["bun", "cron.js", c.name],
    secrets: [{ name: "POSTGRES_PASSWORD", ref: "eso" }],
    secretName: SERVICE_SECRET_TARGETS["portal-data-purge"].secretName, // shared; both need only POSTGRES_PASSWORD
    env: { TZ, POSTGRES_HOST: controlCenterPostgresHost },
    imagePullSecrets: [GHCR_PULL_SECRET_NAME],
  }));
}
```

`cronSpecs()` returns `[...generatedCronSpecs(), <legacy portal-data-purge block,
UNCHANGED>, map-extract, postgresBackupCronSpec(...)]`. After 2a the generated
entry is named `guest-wifi-purge`, so there is **no name collision** with the
legacy `portal-data-purge` block. (If you skip 2a the two collide — 2a is
load-bearing.)

Relative import: `infra/src/crons.ts` → `../../features/_generated/crons.gen`
resolves to repo-root/features/_generated/crons.gen by path (no alias; drizzle-kit
uses the same relative-import trick for schema.gen.ts). Verify `infra` typechecks +
`infra` tests pass with the cross-workspace import; Biome permits `infra → features`
(no rule bans it, verified).

### 2d. Regenerate

`bun run apps:gen` — `crons.gen.ts` now shows `guest-wifi-purge`;
`cron-handlers.gen.ts` maps `"guest-wifi-purge": guestWifi_purgeCron.run`. Commit
both.

### 2e. Tests

- **Infra (schedule proof):** extend `infra/test/crons.test.ts` — assert
  `cronSpecs(NAS)` (or `deployCrons`) yields a `guest-wifi-purge` CronJob with
  `schedule` = the facet's schedule and `command === ["bun", "cron.js",
  "guest-wifi-purge"]`. This is the "runs ON SCHEDULE" proof: declared schedule →
  rendered k8s CronJob. Combined with commit 1's runtime-dispatch test (facet.run()
  fires when dispatched), the two together prove the full chain: `defineCron` →
  `crons.gen.ts` → k8s CronJob(schedule, `bun cron.js <name>`) → `CRON_HANDLERS` →
  `purgeCron.run()`.
- **Seam test:** update commit 1's `cron-run.test.ts` name literal from
  `"portal-data-purge"` to `"guest-wifi-purge"`.
- **Guest-wifi:** grep for any test asserting `purgeCron.name === "portal-data-purge"`
  and update to `"guest-wifi-purge"`.
- **Placeholder-tiles / bento:** no tile change in this unit (guest-wifi already
  folded) — but run `bunx vitest run apps/web` placeholder-tiles anyway per the
  standard chain (cheap; nothing should move).

### Commit-2 verify

Full chain (below). Extra: confirm `db:generate` shows NO schema change (S2 touches
no tables). Confirm the Biome dep rule stays green (no `features → apps/api`;
guest-wifi reaches nothing new). Confirm `infra` typecheck + `infra` tests green
(cross-workspace `crons.gen` import). Then commit + push + watch CI + **confirm the
infra deploy** (see below).

---

## Full verify chain (both commits, IMPLEMENTER runs in order)

```
bun run apps:gen                       # crons.gen.ts (data) + cron-handlers.gen.ts (barrel)
bun run typecheck
bunx vitest run apps/api scripts/apps-gen infra   # incl. cron-run seam test + infra crons test
bun run apps:check                     # crons.gen.ts drift only; cron-handlers.gen.ts intentionally excluded
bun run knip                           # zero-tolerance; cron-run.ts must be a recognized entry (see 1e knip note)
bun run lint                           # Biome incl. dep-boundary rule
git pull --rebase --autostash          # parallel sessions push main
git add <explicit paths>               # NEVER git add -A
git commit -m "<message>"              # NO backticks, NO em-dashes
git push
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor (subagents stall)
# then confirm deploy green + pod image age (memory ci-cancelled-runs-strand-image-digests)
```

## Infra / Pulumi deploy implications

- **Commit 2 changes the deployed k8s topology** (adds a `guest-wifi-purge`
  CronJob; the `portal-data-purge` CronJob's command is UNCHANGED but the image it
  runs now purges four tables instead of five). The push-to-`main` CI/deploy is
  product-aware and rebuilds the **api image** (both `purge.js` and the new
  `cron.js` bundles) and applies the **infra Pulumi** change. Verify the deploy runs
  the infra apply and the new CronJob object appears
  (`kubectl get cronjob -n control-center` → `guest-wifi-purge`), and that pod image
  age advanced (memory `ci-cancelled-runs-strand-image-digests`).
- **Pulumi digest pins** (`wwvinfra:imageDigests.*`, memory
  `pulumi-cloudflare-v5-v6-import-pin` neighbourhood): the api image digest must be
  re-pinned by the deploy so the CronJobs run the new bundle — confirm the
  `guest-wifi-purge` CronJob's image digest matches the freshly-built api image, not
  a stranded old one.
- **No new ESO secret** if `guest-wifi-purge` shares
  `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName` (D5). If review decides a
  dedicated secret target is cleaner, that adds a `secrets-map.ts` entry + a
  `secret/vault.yaml` addition + an ESO reconcile — heavier; the shared-secret path
  is recommended and avoids it.
- **Verify on schedule after deploy:** the Wave-4 boundary review (manager, not this
  unit) should confirm the `guest-wifi-purge` CronJob fires (kick a manual run:
  `kubectl create job --from=cronjob/guest-wifi-purge guest-wifi-purge-manual -n
  control-center`, check its pod logs for "cron complete", and that
  `portal_authorization` rows past the 90-day cutoff were deleted).

## Commit messages (no backticks, no em-dashes in -m)

1. `feat(cron): generic cron-run seam over crons.gen.ts + cron.js dispatch (S2)`

   Body: Add a generic cron dispatcher (apps/api/src/cron-run.ts, bundled to
   cron.js) that looks a cron up in a new features/_generated/cron-handlers.gen.ts
   barrel and invokes its run(). Capture the facet export id + dir in collect so the
   barrel emits static named imports (mirrors jobs.gen.ts). crons.gen.ts (data,
   consumed by infra) is unchanged. No behaviour change: nothing runs cron.js in
   prod yet.

2. `feat(guest-wifi): migrate portal purge onto the S2 cron seam`

   Body: Rename the guest-wifi purge facet to guest-wifi-purge and drive it through
   the seam. infra/src/crons.ts now iterates GENERATED_CRONS to emit one k8s CronJob
   per facet (bun cron.js <name>); the portal purge is removed from apps/api purge.ts
   (which keeps running weather/frontend-log/wake/github until those features fold).
   The legacy portal-data-purge CronJob is preserved to avoid orphaning it.

---

## Gotchas (inherited into this unit)

- **`features → apps/api` is Biome-banned; `apps/api → @features` and `infra →
  features` are allowed.** `cron-run.ts` (apps/api) importing
  `@features/_generated/cron-handlers.gen` is fine; `infra/src/crons.ts` importing
  `../../features/_generated/crons.gen` is fine. Confirm the dep rule stays green.
- **`bun build` reads the CWD tsconfig `paths`** — the `cron.js` bundle MUST
  `cd apps/api` (Dockerfile) to resolve `@features` (memory
  `bun-build-alias-needs-cwd-tsconfig`; local typecheck passes even when wrong, CI
  fails).
- **knip is zero-tolerance.** `cron-run.ts` is a Docker entrypoint with no static
  importer — it must be registered as a knip entry the SAME way `purge.ts` is, or
  knip goes red. Inspect the knip config's treatment of `apps/api/src/purge.ts` and
  replicate for `cron-run.ts` before pushing.
- **`cron-handlers.gen.ts` is intentionally OUT of `apps:check` drift** (mirror
  `jobs.gen.ts`); `crons.gen.ts` stays IN. Do not add the barrel to AGGREGATES.
- **Atomic infra flip.** Commit 2's rename (2a) + infra iteration (2c) + purge.ts
  edit (2b) are one behavioural change — land them together so `GENERATED_CRONS`
  never carries a name that collides with the still-present legacy block.
- **Parallel sessions push `main` (~8-10 concurrent).** `git pull --rebase
  --autostash` every time; NEVER `git add -A` (memory
  `never-git-add-all-shared-checkout`); lefthook format re-stages the whole tree —
  stage explicit paths and `git show --stat HEAD` before push (memory
  `lefthook-format-restages-whole-tree`).
- **No backticks / em-dashes in `git commit -m`** (zsh command substitution).
- **`CLAUDE.md` is a symlink to `AGENTS.md`** — never `sed -i` it (memory
  `apps-layout-move-landed`).
- **Subagents die if they yield to a background CI monitor** — run `gh run watch
  --exit-status` in the FOREGROUND (memory `subagent-background-wait-stalls`).
- **Cron cadence guard:** S2 crons are k8s CronJobs (≥1-min granularity). NEVER
  route a sub-minute interval (enforcers 1s, weight-ingest 15s, github-poll 10s)
  through S2 — those stay hand-wired in `apps/worker` (master plan "Interval cycles
  are NOT a seam").

---

## PLACEHOLDERs (open — flag to the manager / plan-reviewer)

- **PLACEHOLDER-1 — `purge.ts` end-of-life.** The master plan (Wave 4 boundary) says
  "the hand-wired `apps/api/src/purge.ts` is removed." That is **NOT achievable in
  S2** — `purge.ts` still runs the weather/frontend-log/wake/github purges whose
  features fold in Waves 5/7. S2 removes ONLY the portal purge from it. Confirm with
  the manager that this deviation is accepted: `purge.ts` + its legacy
  `portal-data-purge` CronJob survive until F-weather / F-felogs / F-wakes /
  T-deploys each add their own `defineCron` (each removing its purge from `purge.ts`),
  at which point `purge.ts` empties and is deleted. The seam is designed to absorb
  each of those with zero new infra wiring.
- **PLACEHOLDER-2 — shared secret vs dedicated target.** D5 shares
  `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName` for the new
  `guest-wifi-purge` CronJob to avoid an ESO addition. Verify nothing in
  `secrets-map.ts` / `eso.ts` asserts a 1:1 job↔target mapping (e.g. a per-target
  workload-name assertion). If it does, add a `guest-wifi-purge` secret target
  (`secrets-map.ts` + `secret/vault.yaml`) — heavier, and it would need an ESO
  reconcile on deploy.
- **PLACEHOLDER-3 — `import.meta.main` test-safety.** Confirm bun's `import.meta.main`
  reliably distinguishes "run as entrypoint" from "imported by vitest" (§D4). If not,
  split the dispatch guard into a 3-line `cron-run.entry.ts` (the Docker bundle
  target) that only calls `runCron`, leaving `cron-run.ts` a pure importable module.
```
