# CI Pipeline Latency Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut push→prod lead time from 35.8m p50 / 101m p90 down to ~6-8m p50 by removing queue saturation and shortening the critical path.

**Architecture:** Two independent problems. (1) *Queueing*: `cancel-in-progress: true` on `main` kills runs before they deploy, and at ρ≈1.02 the backlog never clears — fixed by letting main batch instead of thrash. (2) *Critical path*: builds needlessly wait on tests, the test job runs two independent suites back-to-back, and coverage instrumentation runs for badges that were deleted from the README a month ago — fixed by parallelising and deleting dead work.

**Tech Stack:** GitHub Actions, Bun 1.2.19, Vitest 3 (forks pool + Playwright/Chromium browser mode), Pulumi, Docker buildx.

## Global Constraints

- Repo is **public** → `ubuntu-latest` runners are **4 vCPU / 16GB**; Actions minutes are free, so runner-minute savings are NOT a goal — latency is.
- GitHub Free plan caps **20 concurrent jobs** per account. One CI run after Task 3 uses ~13 jobs. Do not shard beyond that ceiling.
- **Never weaken the deploy gate.** `deploy` must continue to require test + typecheck success. Building an image early is fine; deploying an untested one is not.
- Two guard scripts statically parse `.github/workflows/ci.yml`: `scripts/check-control-center-ci-split.ts` and `scripts/check-product-ci-isolation.ts`. Neither asserts on `needs:` or `concurrency:`, but `check-control-center-ci-split.ts` **requires `image: www-control-center-storybook` to remain present** — do not delete the `build-storybook` job.
- Coverage is deliberately **not** a gate (`vitest.config.ts:50-54`). Do not add thresholds.
- Follow repo workflow: work directly on `main`, one commit per task, push each commit immediately.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/measure-ci-latency.ts` | Create | Measurement harness — p-values for pipeline duration and push→prod lead time. Verifies every later task. |
| `.github/workflows/ci.yml` | Modify | Concurrency policy, job dependency graph, test job split |
| `scripts/gen-badges.ts` | Delete | Dead — README badges removed 2026-06-20 (`c2fcd87b8`) |
| `.github/badges/*.json` | Delete | Dead — nothing renders these |
| `scripts/coverage.sh` | Modify | Drop coverage instrumentation + blob merge; keep both suites running |
| `package.json` | Modify | Remove `badges` script |
| `lefthook.yml` | Modify | Remove stale badge comment |
| `vitest.config.ts` | Modify | `maxWorkers: 2 → 4` |
| `products/control-center/web/vitest.config.ts` | Modify | Delete dead `poolOptions` block (ignored in workspace mode) |
| `products/captive-portal/apps/frontend/vitest.config.ts` | Modify | Delete dead `poolOptions` block |

---

### Task 1: Measurement harness

Everything downstream is justified by measured numbers, so build the measuring device first and capture a baseline before changing anything.

**Files:**
- Create: `scripts/measure-ci-latency.ts`
- Modify: `package.json` (add `measure:ci` script)

**Interfaces:**
- Produces: `bun run measure:ci [days]` → prints pipeline-duration and lead-time percentiles. Consumed by the verification step of Tasks 2-6.

- [ ] **Step 1: Write the measurement script**

Create `scripts/measure-ci-latency.ts`:

```typescript
/**
 * Measures CI pipeline latency two ways, because they answer different questions:
 *
 *  - PIPELINE DURATION: run start -> deploy job finished. What we control by
 *    making jobs faster.
 *  - LEAD TIME: a push landing -> the first successful deploy at or after it.
 *    What actually matters to a human waiting for their commit to reach prod.
 *    Diverges wildly from pipeline duration when runs get cancelled, because a
 *    superseded push has to wait for someone else's later run to carry it.
 *
 * Usage: bun run measure:ci [days]   (default 7)
 */
const DAYS = Number(process.argv[2] ?? 7);
const REPO = "0x63616c/world-wide-webb";
const WORKFLOW = "ci.yml";

type Run = {
  id: number;
  created_at: string;
  conclusion: string | null;
  event: string;
  head_sha: string;
  display_title: string;
};
type Job = {
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
};

async function gh<T>(path: string): Promise<T> {
  const proc = Bun.spawn(["gh", "api", path], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`gh api ${path} failed: ${await new Response(proc.stderr).text()}`);
  }
  return JSON.parse(out) as T;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

function report(label: string, values: number[]): void {
  const s = [...values].sort((a, b) => a - b);
  console.info(`\n${label}  (n=${s.length})`);
  if (s.length === 0) {
    console.info("  no data");
    return;
  }
  for (const p of [0.5, 0.75, 0.9, 0.95]) {
    const v = pct(s, p);
    console.info(`  p${String(p * 100).padStart(2)}  ${v.toFixed(0).padStart(6)}s  ${(v / 60).toFixed(1)}m`);
  }
  console.info(`  max  ${s[s.length - 1].toFixed(0).padStart(6)}s  ${(s[s.length - 1] / 60).toFixed(1)}m`);
}

const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);

// Two pages of 100 covers a week comfortably at this repo's push rate.
const runs: Run[] = [];
for (const page of [1, 2]) {
  const res = await gh<{ workflow_runs: Run[] }>(
    `repos/${REPO}/actions/workflows/${WORKFLOW}/runs?created=%3E%3D${since}&branch=main&per_page=100&page=${page}`,
  );
  runs.push(...res.workflow_runs);
}

const byConclusion = new Map<string, number>();
for (const r of runs) {
  const k = r.conclusion ?? "in_progress";
  byConclusion.set(k, (byConclusion.get(k) ?? 0) + 1);
}
console.info(`window: last ${DAYS}d (since ${since})   runs: ${runs.length}`);
console.info(`conclusions: ${[...byConclusion].map(([k, v]) => `${k}=${v}`).join(" ")}`);

// Successful deploys: (run start, deploy finished).
const deploys: { start: number; done: number }[] = [];
const pipeline: number[] = [];
for (const r of runs.filter((x) => x.conclusion === "success")) {
  const { jobs } = await gh<{ jobs: Job[] }>(`repos/${REPO}/actions/runs/${r.id}/jobs?per_page=100`);
  const dep = jobs.find((j) => j.name === "deploy" && j.conclusion === "success" && j.completed_at);
  if (!dep?.completed_at) continue;
  const start = Date.parse(r.created_at);
  const done = Date.parse(dep.completed_at);
  deploys.push({ start, done });
  pipeline.push((done - start) / 1000);
}

// Lead time: for every push, when did the first deploy at-or-after it finish?
const leads: number[] = [];
for (const r of runs.filter((x) => x.event === "push")) {
  const pushedAt = Date.parse(r.created_at);
  const carrier = deploys
    .filter((d) => d.start >= pushedAt && d.done >= pushedAt)
    .sort((a, b) => a.done - b.done)[0];
  if (carrier) leads.push((carrier.done - pushedAt) / 1000);
}

report("PIPELINE DURATION (push -> deploy done, green runs only)", pipeline);
report("LEAD TIME (push -> commit live in prod, every push)", leads);

// Utilisation: the number that decides whether queueing dominates.
const hours = new Set(runs.filter((r) => r.event === "push").map((r) => r.created_at.slice(0, 13)));
const pushes = runs.filter((r) => r.event === "push").length;
const medianPipeline = pct([...pipeline].sort((a, b) => a - b), 0.5);
if (hours.size > 0 && Number.isFinite(medianPipeline)) {
  const arrivalsPerHour = pushes / hours.size;
  const capacityPerHour = 3600 / medianPipeline;
  const rho = arrivalsPerHour / capacityPerHour;
  console.info(
    `\nUTILISATION  arrivals ${arrivalsPerHour.toFixed(2)}/active-hour  capacity ${capacityPerHour.toFixed(2)}/hour  rho ${rho.toFixed(2)}`,
  );
  console.info(rho >= 1 ? "  SATURATED - backlog grows without bound" : "  stable");
}
```

- [ ] **Step 2: Register the script**

In `package.json`, add alongside the other `scripts` entries:

```json
    "measure:ci": "bun scripts/measure-ci-latency.ts",
```

- [ ] **Step 3: Run it and capture the baseline**

Run: `bun run measure:ci 7`

Expected: output resembling the numbers this plan was built on —

```
PIPELINE DURATION ... p50 ~755s (12.6m)   p90 ~847s (14.1m)
LEAD TIME         ... p50 ~2148s (35.8m)  p90 ~6077s (101.3m)
UTILISATION       ... rho ~1.02  SATURATED
```

Paste the actual output into the commit message. If lead-time p50 is not several times pipeline p50, stop and re-read — the premise of this plan is that queueing dominates, and if that is no longer true the later tasks need re-ordering.

- [ ] **Step 4: Verify lint and typecheck pass**

Run: `bun run lint && bun run typecheck`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-ci-latency.ts package.json
git commit -m "feat(ci): add pipeline latency + lead time measurement script

Baseline before pipeline work: pipeline p50 12.6m, lead time p50 35.8m,
rho 1.02 (saturated). Lead time is 3x pipeline because cancel-in-progress
kills runs before they deploy."
git push
```

---

### Task 2: Stop cancelling in-flight runs on main

At ρ≈1.02 a new push almost always arrives before the current run finishes, so `cancel-in-progress: true` means runs rarely survive to deploy at all — 130 of 200 runs cancelled. GitHub keeps only the newest *pending* run per concurrency group and cancels older pending ones, so turning cancellation off gives free batching: superseded pushes cost zero compute and the newest one carries all their commits.

**Files:**
- Modify: `.github/workflows/ci.yml:28-30`

- [ ] **Step 1: Make cancellation conditional on branch**

Replace lines 28-30:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

with:

```yaml
# On main: NEVER cancel a run that may already be deploying. At the observed
# push rate the pipeline is saturated (rho ~1.02), so cancel-in-progress meant
# runs were killed before reaching deploy and commits waited for someone else's
# later run — lead time p90 was 101m against a 14m pipeline. With cancellation
# off, GitHub keeps only the newest PENDING run per group and cancels older
# pending ones, so intermediate pushes coalesce for free (zero compute) and the
# run that does start carries all of their commits.
# On feature branches: keep cancelling; superseding is the right behaviour there
# and nothing deploys from them.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref_name != 'main' }}
```

- [ ] **Step 2: Verify the workflow still parses and guards pass**

Run: `bun run test:control-center-ci-split && bun run test:product-ci-isolation`
Expected: both print their success line, no assertion errors.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(ci): batch pushes on main instead of cancelling in-flight runs

At rho ~1.02 cancel-in-progress killed runs before they could deploy; 130
of the last 200 runs were cancelled and lead time p90 hit 101m against a
14m pipeline. Feature branches keep the old behaviour."
git push
```

- [ ] **Step 4: Verify on a real run**

Watch the triggered run: `gh run watch $(gh run list --workflow=CI --limit 1 --json databaseId -q '.[0].databaseId')`

Expected: the run completes rather than being cancelled by any push that lands while it is in flight. Confirm a concurrently-pushed commit shows as a *pending* run that gets superseded without consuming a runner.

---

### Task 3: Start builds without waiting for tests

All nine `build-*` jobs declare `needs: [changes, test, typecheck]`, so every image build idles ~8 minutes waiting for tests, then takes ~3 more. Since the build fan-in (170s) is shorter than the test job (479s), moving builds off the test gate makes them disappear under the test job's shadow entirely. **Measured saving: 180s p50.** The safety property is unchanged because `deploy` keeps its own `needs:` on test and typecheck — images may be built for a commit that fails tests, but such a commit can never deploy.

**Files:**
- Modify: `.github/workflows/ci.yml` lines 284, 312, 332, 350, 368, 386, 404, 422, 440

- [ ] **Step 1: Reparent every build job**

For **each** of the nine build jobs — `build-web`, `build-api`, `build-worker`, `build-media-worker`, `build-storybook`, `build-drizzle`, `build-captive-portal`, `build-captive-portal-api`, `build-map-provision` — change its `needs:` line from:

```yaml
    needs: [changes, test, typecheck]
```

to:

```yaml
    needs: [changes]
```

Leave every `if:` condition untouched; they reference `needs.changes.outputs.*`, which still resolves.

- [ ] **Step 2: Add a comment above `build-web` recording why**

Immediately above `  build-web:` (line 283), insert:

```yaml
  # Build jobs depend on `changes` ONLY, not on test/typecheck. They run
  # concurrently with the test suite instead of queueing behind it (measured
  # 180s off the critical path, because the build fan-in is shorter than the
  # test job and now hides entirely under it).
  # This does NOT weaken the deploy gate: `deploy` still lists test + typecheck
  # in its own `needs:`, so an image built for a commit that fails tests is
  # simply never deployed. The only cost is building images for the ~9% of
  # pushes that fail — they are content-addressed and otherwise inert.
```

- [ ] **Step 3: Confirm the deploy gate is intact**

Run: `grep -n -A1 "^  deploy:" .github/workflows/ci.yml`

Expected: the `needs:` line still contains **both** `test` and `typecheck`. If either is missing, stop — the gate has been broken.

- [ ] **Step 4: Verify guards pass**

Run: `bun run test:control-center-ci-split && bun run test:product-ci-isolation`
Expected: both pass. (`check-control-center-ci-split.ts` still finds `image: www-control-center-storybook` — the job was reparented, not removed.)

- [ ] **Step 5: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "perf(ci): run image builds concurrently with the test suite

Build jobs waited ~8m for tests before starting. They now depend on
\`changes\` only and finish under the test job's shadow: 180s off the
critical path (measured, n=43). Deploy still requires test + typecheck,
so untested images can never ship."
git push
```

- [ ] **Step 6: Measure**

After the run goes green: `bun run measure:ci 1`
Expected: pipeline duration p50 drops from ~755s to ~575s.

---

### Task 4: Delete the dead coverage and badge machinery

The README badges were deleted on 2026-06-20 in `c2fcd87b8` ("docs(repo/www-v66k): refresh repo docs and workspace shape") but the CI machinery that feeds them was never removed. For a month every push has paid for v8 coverage instrumentation, a third vitest invocation to merge coverage blobs, badge regeneration, and a commit back to `main` — 60 such commits in the last 7 days — to produce numbers nothing renders. Coverage is explicitly not a gate (`vitest.config.ts:50-54`), so removing instrumentation changes no pass/fail outcome. This also drops `contents: write` from the test job and stops CI pushing to main against your own sessions.

**Files:**
- Delete: `scripts/gen-badges.ts`, `.github/badges/coverage.json`, `.github/badges/commit.json`, `.github/badges/files.json`, `.github/badges/loc.json`
- Modify: `scripts/coverage.sh`, `package.json`, `lefthook.yml`, `.github/workflows/ci.yml`

- [ ] **Step 1: Confirm nothing consumes the badges**

Run:

```bash
grep -rnE "shields\.io|badges/|gen-badges" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.yml" . 2>/dev/null | grep -v node_modules | grep -v '\.claude/worktrees' | grep -v docs/archive | grep -v docs/beads-archive
```

Expected: only `package.json`'s `badges` script, the `lefthook.yml` comment, and `scripts/gen-badges.ts`'s own header — i.e. the machinery referring to itself. **If any README or live doc references a badge URL, stop and reconsider this task.**

- [ ] **Step 2: Delete the badge generator and its output**

```bash
git rm scripts/gen-badges.ts
git rm -r .github/badges
```

- [ ] **Step 3: Strip coverage from the test runner**

Replace the whole of `scripts/coverage.sh` with:

```bash
#!/usr/bin/env bash
#
# Runs BOTH vitest projects: the jsdom unit suite (api + web + workers +
# packages + infra) and the Storybook browser suite (Playwright/Chromium).
#
# They are two invocations because the Storybook project must run from
# products/control-center/web (its storybookScript and setup paths are relative
# to that dir).
#
# No coverage: it was only ever collected to feed README badges, which were
# removed in c2fcd87b8 (2026-06-20). Coverage was never a gate — see the note in
# vitest.config.ts — so dropping the instrumentation changes no pass/fail
# outcome, it just removes the v8 overhead from every push.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Unit projects (jsdom).
bunx vitest run

# 2) Storybook project (chromium). Runs from products/control-center/web.
( cd products/control-center/web && bunx vitest run --project storybook )
```

- [ ] **Step 4: Remove the `badges` script**

In `package.json`, delete this line:

```json
    "badges": "bun scripts/gen-badges.ts",
```

- [ ] **Step 5: Remove the stale lefthook comment**

In `lefthook.yml` around line 58, delete the note reading `# NOTE: badge JSON (.github/badges/*) is refreshed ONLY by the CI test job`. If it is part of a larger comment block, remove only the badge sentence and leave the surrounding text intact.

- [ ] **Step 6: Remove the badge steps and write permission from CI**

In `.github/workflows/ci.yml`, in the `test` job:

Delete these two steps entirely:

```yaml
      - name: Regenerate badge JSON
        run: bun run badges
      - name: Commit refreshed badges (main only)
        if: github.ref == 'refs/heads/main'
        run: |
          ...
```

(the `Commit refreshed badges` step runs through its closing `fi`).

Delete the now-unneeded write permission:

```yaml
    permissions:
      contents: write
```

Change the checkout step from:

```yaml
      - uses: actions/checkout@v4
        with:
          # Full history so the badge commit can rebase cleanly onto main.
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
```

to:

```yaml
      - uses: actions/checkout@v4
```

Rename the test step to drop the stale "with coverage":

```yaml
      - name: Test (unit jsdom + Storybook chromium)
        run: bun run test:coverage
```

Finally update the job's header comment (line ~148-151) — delete the sentence beginning "Also refreshes the self-hosted coverage/LOC badge JSON…".

- [ ] **Step 7: Verify the suite still runs and still fails on real failures**

Run: `bun run test:coverage`
Expected: both suites run to completion and pass. No `coverage/` directory is produced.

- [ ] **Step 8: Verify lint, typecheck, and dead-code checks pass**

Run: `bun run lint && bun run typecheck && bun run knip`
Expected: all pass. Knip is zero-tolerance — if it now flags something that only `gen-badges.ts` referenced, delete that too.

- [ ] **Step 9: Commit and push**

```bash
git add -A
git commit -m "perf(ci): delete dead coverage + badge machinery

README badges were removed in c2fcd87b8 (2026-06-20) but CI kept paying
for them: v8 instrumentation on both suites, a third vitest run to merge
coverage blobs, badge regen, and a commit back to main (60 in 7 days).
Coverage was never a gate (vitest.config.ts), so no pass/fail changes.

Also drops \`contents: write\` from the test job and the full-history
clone that existed only for the badge rebase."
git push
```

- [ ] **Step 10: Measure**

Run: `bun run measure:ci 1`
Expected: pipeline p50 drops a further ~100-130s. This figure was estimated from typical v8 overhead, not measured — record the real number in the next commit message so later planning uses fact rather than estimate.

---

### Task 5: Split the test job into two parallel jobs

`scripts/coverage.sh` runs the unit suite (218s, 238 files) and the Storybook browser suite (174s, 114 files) sequentially in a single step, though they share nothing. Running them as two jobs makes the cost `max(218, 174)` instead of the sum. The cheap hermetic bash guards stay with the unit job, which has no Playwright install, keeping the two sides balanced.

**Files:**
- Modify: `.github/workflows/ci.yml` — replace the `test` job with `test-unit` and `test-storybook`; update `deploy` and `notify` `needs:` lists
- Modify: `package.json` — add split test scripts

**Interfaces:**
- Consumes: `scripts/coverage.sh` from Task 4 (no longer used by CI after this task, retained for local use)
- Produces: job names `test-unit` and `test-storybook`, which `deploy` and `notify` must both list in `needs:`

- [ ] **Step 1: Add split test scripts**

In `package.json`, alongside the existing `test` entry:

```json
    "test:unit": "vitest run",
    "test:storybook": "cd products/control-center/web && bunx vitest run --project storybook",
```

- [ ] **Step 2: Replace the `test` job with `test-unit`**

Rename the job `test:` to `test-unit:` and keep every step **except** the three Playwright steps (`Cache Playwright browsers`, `Install Playwright Chromium`, `Install Playwright system deps`) and the test step. The unit suite is jsdom-only and needs no browser.

Replace its final test step with:

```yaml
      - name: Test (unit, jsdom)
        run: bun run test:unit
```

Add above the job:

```yaml
  # Unit suite (jsdom) + all the fast hermetic bash guards. Split from the
  # Storybook browser suite so the two run concurrently: they share nothing, and
  # sequentially they cost sum(218s, 174s) instead of max(). The guards live
  # here because this job needs no Playwright install, which keeps the two
  # halves roughly balanced.
```

- [ ] **Step 3: Add the `test-storybook` job**

Immediately after `test-unit`, add:

```yaml
  # Storybook browser suite (Playwright/Chromium play functions). Runs
  # concurrently with test-unit. Kept as its own job because it needs a Chromium
  # install that the jsdom suite does not.
  test-storybook:
    needs: [changes]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.2.19
      - name: Install deps
        run: bun install --frozen-lockfile
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-${{ runner.os }}-${{ hashFiles('**/bun.lock') }}
          restore-keys: |
            playwright-chromium-${{ runner.os }}-
      - name: Install Playwright Chromium
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: bunx playwright install --with-deps chromium
      - name: Install Playwright system deps (cached binary)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: bunx playwright install-deps chromium
      - name: Test (Storybook, chromium)
        run: bun run test:storybook
```

- [ ] **Step 4: Give `test-unit` a `needs:` line**

Ensure `test-unit` declares `needs: [changes]` (the old `test` job had no `needs:`; both split jobs should gate on `changes` so they do not run for irrelevant paths).

- [ ] **Step 5: Update `deploy` and `notify`**

In both jobs' `needs:` arrays, replace the single `test` entry with `test-unit, test-storybook`. For example `deploy` becomes:

```yaml
    needs: [changes, test-unit, test-storybook, typecheck, build-web, build-api, build-worker, build-media-worker, build-storybook, build-drizzle, build-captive-portal, build-captive-portal-api, build-map-provision]
```

Apply the same substitution to `notify`.

- [ ] **Step 6: Confirm no dangling references to the old job name**

Run: `grep -n "needs:.*\btest\b" .github/workflows/ci.yml`

Expected: no line lists a bare `test` — every reference is now `test-unit` and/or `test-storybook`. A stale `test` reference makes the workflow invalid and every run will fail immediately.

- [ ] **Step 7: Verify guards, lint and typecheck**

Run: `bun run test:control-center-ci-split && bun run test:product-ci-isolation && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 8: Verify both suites run locally**

Run: `bun run test:unit && bun run test:storybook`
Expected: both pass, same test counts as before the split (238 unit files, 114 storybook files).

- [ ] **Step 9: Commit and push**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "perf(ci): split test job into parallel unit and storybook jobs

The two suites share nothing but ran back-to-back in one step (218s +
174s). As separate jobs the cost is max() not sum(). Hermetic bash guards
stay with the unit job, which needs no Playwright install."
git push
```

- [ ] **Step 10: Measure**

Run: `bun run measure:ci 1`
Expected: pipeline p50 around 280-350s. Note which of the two jobs is now the longer — that identifies the next target.

---

### Task 6: Use the whole runner for the unit suite

`vitest.config.ts:26` sets `maxWorkers: 2`. Its own comment reasons that 2 workers × ~1.5GB RSS is "well within CI's 16GB runner" — correct, but it stops there and leaves half the cores idle. Public-repo runners are 4 vCPU / 16GB. Measured parallel efficiency at 2 workers is 89% (386.9s of phase work in 218.5s wall), so scaling should be close to linear. Dropping coverage in Task 4 also reduced per-worker RSS, widening the headroom further.

The `maxForks` blocks in the two per-project configs are dead — commit `eb6458460` established that workspace mode ignores per-project `poolOptions`, and `vitest.config.ts:29` says the same. They are deleted here because they read as live tuning and actively mislead.

**Files:**
- Modify: `vitest.config.ts:22-26`
- Modify: `products/control-center/web/vitest.config.ts:18-24`
- Modify: `products/captive-portal/apps/frontend/vitest.config.ts:20-27`

- [ ] **Step 1: Record the current unit-suite wall time**

Run: `time bun run test:unit`
Expected: note the real elapsed time (~218s on CI, faster locally). This is the before number.

- [ ] **Step 2: Raise `maxWorkers`**

In `vitest.config.ts`, replace lines 22-26:

```typescript
    // 2 workers: measured peak RSS is ~1.5GB per worker (jsdom + React +
    // v8 coverage), so 2 workers use ~3GB total, well within CI's 16GB runner.
    // Serial (maxWorkers: 1) was previously set based on a stale ~12GB/worker
    // estimate that didn't match actual measurements.
    maxWorkers: 2,
```

with:

```typescript
    // 4 workers: public-repo runners are 4 vCPU / 16GB. Peak RSS was measured at
    // ~1.5GB per worker back when v8 coverage was still instrumented; without it
    // 4 workers sit well under half the available RAM, so cores are the binding
    // constraint, not memory. Measured parallel efficiency at 2 workers was 89%
    // (386.9s of phase work in 218.5s wall), so this scales close to linearly.
    // If the suite starts flaking on timing-sensitive Board tests, or a worker
    // OOMs, drop back to 2 — this is a tuning knob, not a correctness boundary.
    maxWorkers: 4,
```

- [ ] **Step 3: Delete the dead per-project pool config (web)**

In `products/control-center/web/vitest.config.ts`, delete the `pool` and `poolOptions` keys (lines ~18-24):

```typescript
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
```

Leave `environment`, `globals`, and the `testTimeout` comment untouched — the 20s timeout is still load-bearing for the Board integration suites.

- [ ] **Step 4: Delete the dead per-project pool config (captive portal)**

Apply the identical deletion in `products/captive-portal/apps/frontend/vitest.config.ts` (lines ~20-27).

- [ ] **Step 5: Verify the suite still passes and is faster**

Run: `time bun run test:unit`
Expected: all tests pass, wall time meaningfully below the Step 1 figure. If any test now fails or flakes, revert to `maxWorkers: 2` and stop — this task is optional and not worth destabilising the suite.

- [ ] **Step 6: Run it twice more to check for flake**

Run: `bun run test:unit && bun run test:unit`
Expected: green both times. Timing-sensitive tests under higher parallelism are the main risk here, and a single green run does not rule it out.

- [ ] **Step 7: Verify lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: both pass.

- [ ] **Step 8: Commit and push**

```bash
git add vitest.config.ts products/control-center/web/vitest.config.ts products/captive-portal/apps/frontend/vitest.config.ts
git commit -m "perf(test): use all 4 runner cores for the unit suite

maxWorkers was 2 on a 4 vCPU runner; measured efficiency at 2 workers was
89%, so this scales close to linearly. Also deletes the per-project
maxForks blocks, which workspace mode ignores (eb6458460) and which read
as live tuning while doing nothing."
git push
```

- [ ] **Step 9: Final measurement**

Run: `bun run measure:ci 1`

Then, once a full day of pushes has accumulated: `bun run measure:ci 7`

Expected end state: pipeline p50 ~280-300s (from 755s), lead time p50 ~6-8m (from 35.8m), ρ ~0.4 and reported as `stable` rather than `SATURATED`.

---

## Verification Summary

| After task | Pipeline p50 | Lead time p50 | Basis |
|---|---|---|---|
| baseline | 755s (12.6m) | 2148s (35.8m) | measured, n=43 |
| 2 (batching) | unchanged | ~15m | queueing model, ρ still ~1.0 |
| 3 (builds ∥ test) | ~575s | ~12m | **measured**, n=43 |
| 4 (drop coverage) | ~450s | ~9m | estimated from v8 overhead |
| 5 (split test) | ~300s | ~7m | measured suite split, 218s/174s |
| 6 (maxWorkers) | ~280s | ~6.5m | 89% measured efficiency |

Only the Task 3 figure is directly measured end-to-end. Treat 4 and 6 as estimates until `measure:ci` confirms them.

## Deliberately Out Of Scope

Each of these is a real lever, deferred because it carries risk or ops burden that the tasks above do not:

- **Shard the Storybook suite.** `fileParallelism: false` (`vitest.workspace.ts:39`) serialises it to avoid overloading one Chromium (www-hjvu). Sharding across runners sidesteps that rather than fighting it, and is the obvious next step once Task 5 shows Storybook as the long pole — but it adds jobs against the 20-concurrent cap.
- **Tighten path filters.** Every filter includes `products/control-center/**`, so a web-only change rebuilds api, worker, media-worker and storybook. Narrowing them would skip builds entirely on most pushes, but too-tight filters ship stale images, and the current breadth is a deliberate response to www-355t.
- **Cache the deploy tooling.** `deploy` curls sops, age and the Pulumi CLI on every run (~25s). Trivial to fix, small payoff, worth doing when the deploy job next needs editing.
- **Self-hosted runners on the homelab.** Warm Docker layer caches (likely the cause of the p50→p90 doubling on build jobs), a local registry instead of a GHCR round-trip, and no 20-job cap. Largest remaining win and the largest ops commitment.

## As Shipped (2026-07-20)

- 8 build jobs, not the 9 this plan assumed — `build-media-worker` was merged into `build-worker` by a separate, concurrent effort, not by this plan. 14 jobs total in `ci.yml`.
- Measured baseline was worse than estimated above: pipeline p50 777s, lead time p50 2227s, ρ 1.14 (n=43) — vs. this plan's 755s/2148s/~1.0.
- Task 6 (`maxWorkers: 4`) measured 1.93x on the unit suite locally: 71.9s → 37.2s, three green runs, no flake.
- End-to-end pipeline effect of the full stack (Tasks 3-6 combined) has not been re-measured yet — needs `bun run measure:ci 7` after a full day of pushes on `main`.
