# GitHub / Deploy Status Tile — Design

Date: 2026-07-18
Status: approved, not yet implemented

## Problem

There is no way to answer, from the wall panel, what the app is running versus
what has shipped. Six concrete questions drive this design:

1. What deploy is this app (this browser tab) running?
2. What is currently deployed to the homelab cluster?
3. Are there pipeline failures, and what are the errors?
4. What changed in those deploys — when, and in which commits?
5. Is this tab behind the current deploy?
6. Is a deploy running right now?

All six are answerable from the GitHub REST API alone. No cluster introspection
is required, because `ci.yml`'s `deploy` job pins `wwwinfra:imageDigests` from
`github.sha` — so "what is deployed" is exactly "the SHA of the last successful
`deploy` job on `main`".

## Scope

In scope: one new tile, one worker poll loop, one tRPC router, two tables, a
retention sweep, and a fix to the api build-SHA injection.

Out of scope: triggering or re-running deploys from the panel (read-only by
design), non-`main` branches, PR status, and any product other than
control-center.

## Architecture

Follows the existing external-integration pattern exactly: worker polls, zod
validates at the edge, Postgres stores, tRPC reads the DB, tile reads tRPC. The
tile never talks to GitHub, and neither does the api.

```
GitHub REST ──> worker loop ──> zod ──> Postgres ──> tRPC router ──> tile
                (github-service.ts)                  (routers/github.ts)
```

Template to copy: `api/src/services/asc-version-service.ts` — external REST, a
base-URL const, a zod edge schema, an `isConfigured()` guard that no-ops when
credentials are unset, a cycle function that never throws so last-known data
survives, and a singleton-row upsert.

### Why not webhooks

Webhooks would be sub-second instead of ~10s, but cost public ingress to the
api, HMAC verification, a webhook secret, and a polling backstop for missed
deliveries. On a wall panel 10s is imperceptible. Polling has no ingress surface
and no missed-delivery failure mode. Revisit only if instant feedback is wanted.

## Data source

Repo: `0x63616c/world-wide-webb`. Endpoints:

| Endpoint | Purpose | When |
|---|---|---|
| `GET /repos/{o}/{r}/actions/runs?branch=main&per_page=20` | run list, status, conclusion, head SHA, timings | every tick |
| `GET /repos/{o}/{r}/actions/runs/{id}/jobs` | per-job status; which job/step failed | runs that are in-flight or failed |
| `GET /repos/{o}/{r}/actions/jobs/{id}/logs` | failure log tail | once, on a job flipping to `failure` |
| `GET /repos/{o}/{r}/commits/{sha}` | commit message, author, changed files, stat totals | once per newly-seen SHA |

Note: `/actions/jobs/{id}/logs` redirects to a **plain-text** log for that single
job — not the multi-megabyte zip that `/actions/runs/{id}/logs` returns. Fetch
job logs, never run logs. Store the last 4KB.

### Why job-level, not just run-level

A run stays `in_progress` until every job finishes, so waiting on the run
conclusion reports a failure 1-2 minutes late. Polling jobs catches it as soon
as the job flips, and is also what identifies the failing step for the log tail.

Job-level polling is also required for correctness of "what is deployed":
`ci.yml` uses `dorny/paths-filter`, so a run can conclude `success` with the
`deploy` job **skipped**. Currently-deployed is therefore the newest run whose
`deploy` job conclusion is `success` — not merely the newest successful run.

### Polling cadence

- Idle (no run in flight): **60s** → ~60 req/hr
- Hot (>=1 run in flight): **10s** → ~720 req/hr with the jobs call
- Worst realistic case (3 concurrent runs): ~1440 req/hr

Budget is 5000/hr, so worst case is ~30% and the hot window only lasts the
length of a deploy. Secondary abuse limits (~900 points/min) are untouched at
6-24 req/min.

Optimization, not an assumption: store an ETag per endpoint and send
`If-None-Match`. GitHub documents 304 responses as exempt from the primary rate
limit; **verify that this still holds at implementation time** rather than
depending on it. The design is within budget without it.

### Log-tail timing

Job logs 404 or return partial content for several seconds after a job flips to
`failure`. Do not couple the two fetches — a 404 would then cost a whole cycle.
Instead: mark the failure immediately (tile red in <=10s), fetch the tail on a
subsequent tick (error text in ~30s), retry with backoff, and cap attempts.

## Credentials

Reuses the existing vault entry `GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN`. No new
secret is minted.

Mounted to **`worker` only, not `api`.** Because failure logs are prefetched by
the worker, the api never calls GitHub, so it does not need the credential. This
keeps the token out of the only service that terminates HTTP requests from the
panel.

Implementation note: `secrets-map.ts:38` defines `workerSecrets` as a spread of
`apiSecrets`, so this needs a key added to `workerSecrets` directly rather than
to the shared base. `deploy-config.test.ts` asserts the api/worker overlap —
confirm it tolerates worker-only extras; if that invariant is deliberate, mount
to both and record why.

Touchpoints (4, since the vault entry exists):

1. `infra/src/secrets-map.ts` — add to `workerSecrets`
2. `infra/src/services.ts:288` — worker mount
3. `api/src/env.ts` — `SECRET_FILE_ENV` entry + schema field, defaulting `""`
4. logger redaction list

Env var name: `GITHUB_ACTIONS_TOKEN`. Deliberately **not** `GITHUB_TOKEN` — that
name collides with the Actions built-in, which
`docs/secrets-sops-migration/GOAL.md:26` treats as reserved. Conflating a vault
PAT with the workflow built-in is a credential-confusion hazard.

### Known risk (accepted)

The reused PAT appears to be a classic, broad-scope token. The narrowest classic
scope that reads a private repo's Actions is `repo`, which also grants write to
code and branches. Since a push to `main` triggers deploy, a leak from the
worker escalates from "reads deploy status" to "ships code to prod".

This was raised and consciously accepted to avoid minting a new credential.
Mitigations applied: worker-only mount, logger redaction, and no code path that
echoes the token or GitHub error bodies to the client.

Cheap future hardening, if ever wanted: replace with a fine-grained token scoped
to this repo with Contents/Actions/Metadata read only. No code changes needed —
only the vault value. A GitHub App would additionally remove expiry entirely via
hourly self-rotating installation tokens, reusing the `crypto.subtle` JWT
signing already present for App Store Connect.

Expiry is a real failure mode either way: PATs expire and the failure is silent.
The staleness envelope below is what makes it loud.

## Data model

Two tables plus a singleton. Exact schema file location follows the existing
drizzle convention — confirm during planning.

**`github_run`** — one row per workflow run on `main`.

- `id` (GitHub run id, PK), `run_number`, `workflow_name`
- `head_sha`, `commit_message`, `commit_author`
- `status` (`queued` | `in_progress` | `completed`), `conclusion`
- `deploy_job_conclusion` — nullable; drives "currently deployed"
- `failed_job_name`, `failed_step_name` — nullable
- `started_at_utc`, `completed_at_utc`
- `changed_file_count`, `additions`, `deletions`
- `html_url`

**`github_run_log_tail`** — separate table so the 4KB blobs never bloat the hot
read path.

- `run_id` (FK), `job_id`, `log_tail` (last 4KB), `fetched_at_utc`

**Poll-state singleton** — the staleness envelope, modeled on
`weather-ingest-service.ts:129-142`: `last_polled_at_utc`, `last_error`,
`consecutive_failures`, plus the denormalized currently-deployed SHA so the
tile can answer question 2 in one read.

### Retention

30-day purge, mirroring the `frontend_log` sweep added in `efa20e47d`.

- `github_run`: purge rows older than 30 days
- `github_run_log_tail`: purged in the same sweep
- **The currently-deployed singleton is never purged.** If the last deploy is 31
  days old, purging it would leave the tile unable to answer question 2 at all.
  Purge the history, keep the pointer.

Volume is trivial — a few thousand rows a month, failures rare. This is hygiene,
not pressure.

## Tile

`worldCol: 34, worldRow: 24, cols: 4, rows: 3` — a clean rectangle right of
Climate, no existing tile moves.

Registration requires three edits to `tile-registry.ts`: import the component
pair, add both `typeof` members to the `TileComponent` and `TileViewComponent`
unions, and append the entry. Missing the unions is a type error.

Follows the container/view split, copying `NetworkTile` (not `WeatherNow`, which
hardcodes its interval and uses a relative import):

- `tiles/DeployTile.tsx` — container, `trpc.github.status.useQuery` with
  `refetchInterval` from a new `POLL.deploy` in `lib/hooks.ts`
- `tiles/DeployTileView.tsx` — pure, discriminated `status` prop
- `tiles/DeployTileView.stories.tsx`
- `tiles/__tests__/` — container, view, and stories tests

`ownsTap: true` — the tile opens its own modal rather than the generic showcase.

### Layout

**Status band (top).** The drift answer, glanceable across the room. Three SHAs:
this tab's (`__BUILD_HASH__`, already wired), the deployed one, and `main`'s
head. Renders as one of:

- `up to date` — all three match
- `N commits behind` — tab or cluster trails `main`
- `deploying` — run in flight, with elapsed time
- `failed` — red, naming the failing job and step

**Feed (bottom).** Recent commits, newest first: short SHA, message, relative
time, per-commit deploy state, and a compact `+a/-d` diff stat.

Tapping opens a modal with the full commit list, changed files, and for failures
the stored log tail.

### States

Every state is explicit and none of them silently show plausible-but-wrong data:

- loading / error (per the `status` prop convention)
- **unconfigured** — token unset; says so rather than appearing broken
- **stale** — `last_polled_at_utc` older than a threshold, or
  `consecutive_failures` above a threshold. Shows the data *and* that it is
  stale, with the age. This is the state that catches a silently expired PAT,
  so it must be visually distinct, not a subtle tint.

## Web build SHA

Already fully wired, so drift comparison is free: `web/Dockerfile:54-62` ARGs →
`ci.yml:326-328` passes `BUILD_HASH=${{ github.sha }}` → `vite.config.ts`
injects `__BUILD_HASH__` → surfaced via `web/src/config/build.ts`. Also stamped
to `dist/version.json` and polled by `lib/version-check.ts:32`.

## Related fix

`build-api` (`ci.yml:339-346`) passes no build-args and the api Dockerfile has
no ARG, so `env.ts:79` always reports build `"dev"` and `routers/health.ts:26`
reports that untruth in prod. Mirror the `build-web` block. Small, independent,
and directly in service of "what is actually running" — but land it as its own
commit.

## Known limitation

Digest pinning is per-product: a deploy may roll only the products whose paths
changed. So a single "cluster SHA" is an approximation — the web image may be at
one SHA while the api is at another. The tile reports the last successful
`deploy` run SHA, which is the SHA the cluster was last reconciled *to*, not
necessarily the SHA of every running image.

This is correct for the common case and for the questions being asked. If
per-product truth is wanted later, the deployed digest map is available from
Pulumi stack state; not worth the coupling now.

## Testing

- **Service**: zod edge schemas against recorded GitHub fixtures, including a
  run that succeeded with `deploy` skipped, a job-level failure while the run is
  still in flight, and a log fetch returning 404 immediately after failure.
- **Cycle**: never throws on network error; last-known data survives;
  `consecutive_failures` increments; `isConfigured()` no-ops cleanly when the
  token is unset.
- **Retention**: rows past 30 days go; the deployed singleton stays.
- **View**: a story per state — up-to-date, behind, deploying, failed,
  unconfigured, stale, loading, error.
- **Registry**: existing tile-registry tests cover placement and the label/header
  match invariant.

## Open items for planning

1. Confirm `deploy-config.test.ts` tolerates a worker-only secret.
2. Confirm the drizzle schema file location and migration workflow (note:
   generated migration meta JSON needs `bunx biome format --write` before lint
   passes).
3. Verify the ETag 304 rate-limit exemption against current GitHub docs.
4. Confirm the exact vault key name and its actual scope.
