# Review — Unit S2 (cron-run seam + guest-wifi purge migration)

**Reviewer:** independent plan-reviewer (did not author the plan). Verified against
main HEAD `da0be339e`.
**Verdict: APPROVE-WITH-FIXES.** One MAJOR (make the knip entry edit concrete);
the rest are confirmations and resolved placeholders. No BLOCKERS. The seam is
sound, faithfully mirrors the just-landed S1 pattern, and every risky claim in the
plan checks out against real code.

Counts: BLOCKER 0 · MAJOR 1 · MINOR 5.

---

## Pressure-test results (all verified against source)

**1. Runtime shape (k8s CronJob, one-shot) — SOUND for ALL Track-C crons.**
The "not a worker loop / PRD Backend rule 7" claim is REAL:
`apps/api/src/purge.ts:4-5` docstring — "runs it once a day as a one-shot job
(`bun purge.js`) and it exits. NOT a worker loop (PRD Backend rule 7), the
scheduler owns the cadence." AGENTS.md: "Cron jobs live in `infra/src/crons.ts`."
Every Track-C cron is a daily/hourly batch purge (portal 90d, weather 30d,
felog 30d, wake 90d, github). `renderCronJob` (`component.ts:465,475`) emits
`concurrencyPolicy: "Forbid"` + `restartPolicy: "Never"` = exactly the one-shot
failure-isolation the plan relies on. 1-min k8s floor is ample (all schedules are
daily). Sub-minute intervals (enforcers 1s, weight-ingest 15s) correctly stay
hand-wired in `apps/worker` per the master plan. No Track-C cron needs sub-minute
or long-running. ✅

**2. Cron facet brand already exists — CONFIRMED, nothing brand-side needed.**
`app-kit/define-facets.ts`: `CRON_BRAND` (`:5`), `CronSpec {name,schedule,run}`
(`:7-11`), `defineCron` (`:20`). `collect.ts:167-170` already collects
`CRON_BRAND` exports into `crons` as `{name, schedule, source}`. `renderCrons`
(`emit.ts:212`) already emits `crons.gen.ts`. What's missing is exactly what the
plan says: (a) export-id + dir capture on `CollectedCron`, (b) the handler barrel,
(c) the runtime entrypoint, (d) the infra iteration. ✅

**3. Commit-1 genuinely inert — CONFIRMED byte-identical.**
`renderCrons` (`emit.ts:212-242`) reads ONLY `name`/`schedule`/`source`. Adding
`dir`/`exportName` to `CollectedCron` (D3) does not touch its output. The facet is
NOT renamed until commit 2, so `crons.gen.ts` stays `{name:"portal-data-purge",…}`
identical to the committed file (`crons.gen.ts:12`). `apps:check` AGGREGATES
(`apps-check.ts:47-72`) diffs `renderCrons` only → stays green with zero churn.
The new `cron-handlers.gen.ts` is knip-ignored (`knip.json` `features/_generated/**`)
and biome-ignores `.gen.ts`, and is correctly ABSENT from AGGREGATES (mirrors
`jobs.gen.ts`, which is also excluded — confirmed the AGGREGATES list is
tiles/router/guest-router/schema/crons only). ✅

**4. guest-wifi purge removal leaves the other 4 intact — CONFIRMED; no double-purge.**
`purge.ts` runs 5 purges (`:35-39`): portal (guest-wifi db) + weather + frontendLogs
+ wakePhotos + github (api db). S2 removes ONLY the portal path (imports `:21-22`,
call `:35`, spread `:42`, `guestWifiPool.end()` `:61,:65`). The other 4 keep
running through the UNCHANGED legacy `portal-data-purge` CronJob block
(`crons.ts:110-122`, `bun purge.js`). Portal rows are then purged by the NEW
`guest-wifi-purge` CronJob (`bun cron.js guest-wifi-purge`). Disjoint table sets →
no row is double-purged. The legacy `purge.js` block is correctly KEPT (not
double-purging). ✅ (See m2 on same-time scheduling.)

**5. Proof tests genuinely dispatch a cron — CONFIRMED real end-to-end.**
The commit-1 runtime test (`runCron("portal-data-purge")` → `CRON_HANDLERS[...]()`
→ `purgeCron.run` → `purgePortalData(mockedDb)`) is a real invocation, mirroring the
landed `apps/worker/src/__tests__/jobs-seam.test.ts` (which invokes the collected
`notify` handler with a mocked feature db). `apps/api/vitest.config.ts:15,30`
aliases `@features` AND its `include` already runs `features/**/{service,api}.test.ts`
at runtime, so `apps/api/src/__tests__/cron-run.test.ts` resolves
`@features/_generated/cron-handlers.gen` at runtime. The commit-2 infra test
asserts `cronSpecs()` yields a `guest-wifi-purge` CronJob with `schedule` +
`command === ["bun","cron.js","guest-wifi-purge"]` (a real mirror target exists:
`infra/test/crons.test.ts`). The two together prove the full chain. ✅

**6. Infra/Pulumi blast radius — SAFE, no strand/double-schedule.**
Commit 2 adds one CronJob + a `cron.js` bundle to the api image → product-aware
CI rebuilds the api image and applies the infra Pulumi change (correct per memory
`ci-cancelled-runs-strand-image-digests`; verify pod image age post-deploy). No
strand if the deploy completes green. No Pulumi name collision: D5 renames the
facet to `guest-wifi-purge` so the generated object never shares a name with the
still-present legacy `portal-data-purge` block. The cross-workspace import
`infra/src/crons.ts → ../../features/_generated/crons.gen` is SAFE (see m1). ✅

**7. PLACEHOLDER-1 (purge.ts cannot be fully removed in S2) — CONFIRMED, plan is right.**
`purge.ts` still runs weather/felog/wake/github, whose features fold in Waves 5/7.
S2 can only strip the portal purge. The master plan's "purge.ts removed" is an
end-of-Track-C state. The plan's deviation is correct and necessary. RESOLVED below.

**8. Mirror-fidelity to S1 — CONFIRMED consistent.**
`generatedCronSpecs()` maps `GENERATED_CRONS` the way S1's worker spreads
`GENERATED_JOBS`. The one intentional divergence — infra iterates the DATA file
(`crons.gen.ts`) while the runtime iterates the HANDLER barrel
(`cron-handlers.gen.ts`) — is the correct two-file split (D2), and it is exactly
why the infra import is safe: `crons.gen.ts` has ZERO imports (pure interface +
const), so infra never pulls feature runtime or needs the `@features`/`@app-kit`
alias. This is the load-bearing reason the split is right, not just aesthetic. ✅

---

## Findings

### [MAJOR] F1 — Make the knip entry edit concrete (not "replicate purge.ts").
`§1e`/gotchas say "verify `purge.ts`'s knip entry treatment and replicate for
`cron-run.ts`." The concrete edit is: add `"src/cron-run.ts"` to the `apps/api`
`entry` array in `knip.json` (currently
`["src/server.ts", "src/purge.ts", "src/db/seed.ts"]`). Without this exact edit,
knip goes red on `cron-run.ts` as an unused file (it is a Docker entrypoint with no
static importer, identical to `purge.ts`). State the literal array edit in the plan
so the implementer cannot miss it. (`cron-handlers.gen.ts` needs no knip entry — it
falls under the ignored `features/_generated/**` glob.)

### [MINOR] F2 — infra cross-workspace import is safe; downgrade the "verify" hedge to confirmed.
Verified: root `tsconfig.json` has NO `rootDir`, NO `composite`, `noEmit: true`,
`moduleResolution: "bundler"`. `infra/tsconfig.json` (`include: ["src","test",
"scripts","program.ts"]`) does not list `../../features`, but TS still typechecks
transitively-imported files, and `crons.gen.ts` is import-free data, so no TS6059
and no alias needed. `bun run typecheck` (infra = `tsc --noEmit`) stays green;
vitest resolves it at runtime regardless. The plan's "verify infra typechecks" step
is fine to keep, but this is low-risk, not a live hazard.

### [MINOR] F3 — Two CronJobs fire at 02:00; call it out as intended.
After commit 2 both the legacy `portal-data-purge` and the new `guest-wifi-purge`
CronJobs run at `0 2 * * *` (same schedule from the facet). Harmless — disjoint
table sets, both `concurrencyPolicy: Forbid`, both need only `POSTGRES_PASSWORD` —
but the plan should note the two pods start concurrently so a reviewer doesn't read
it as a double-schedule bug. No action beyond a one-line note.

### [MINOR] F4 — PLACEHOLDER-3 (`import.meta.main`) is safe; keep the guard, fallback unneeded.
Node (incl. vitest) does NOT define `import.meta.main` → it is `undefined` → falsy,
so importing `cron-run.ts` in a test never fires the dispatch. Bun sets it `true`
for the entry module, so `bun cron.js` dispatches. The guard degrades safely in
both directions; the split `cron-run.entry.ts` fallback is not needed. (The only
in-repo `import.meta.main` user is `scripts/apps-check.ts`, a bun script — same
mechanism.) Ship the guard as written.

### [MINOR] F5 — validate.ts dup-cron-name check (1d) is low-value but harmless.
With one cron it never throws. Include it for the 10x invariant as the plan says;
just don't let it block — it is inert today. No change needed.

---

## PLACEHOLDER resolutions

- **PLACEHOLDER-1 — purge.ts end-of-life: RESOLVED, deviation ACCEPTED.** `purge.ts`
  MUST survive S2. It still runs weather/frontend-log/wake/github (features fold
  Waves 5/7); S2 removes only the portal purge. The legacy `portal-data-purge`
  CronJob stays running `bun purge.js` for those four. `purge.ts` empties and is
  deleted only when the last of those features adds its own `defineCron`. The seam
  absorbs each with zero new infra wiring. The master plan's "purge.ts removed" is
  an end-of-Track-C state, not an S2 deliverable.

- **PLACEHOLDER-2 — shared secret vs dedicated target: RESOLVED, SHARE it.** No 1:1
  job↔target coupling exists. `SERVICE_SECRET_TARGETS` (`secrets-map.ts:76-82`) is a
  plain `Record` derived from the platform manifest usages; a `secretName` is just a
  string, and eso/vault create ONE k8s Secret per SERVICE workload — any pod in the
  namespace may mount it. The new `guest-wifi-purge` CronJob reusing
  `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName` adds NO new target, so
  the golden snapshot `infra/test/secrets-derivation.test.ts` is unaffected and no
  ESO/vault addition is needed. Both jobs need only `POSTGRES_PASSWORD`. Use the
  shared secret; do not add a dedicated target.

---

## Bottom line
Ready to implement after F1 (concrete knip edit). Everything else is confirmed.
