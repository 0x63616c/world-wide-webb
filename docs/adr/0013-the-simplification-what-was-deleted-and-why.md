# The Simplification: what was deleted and why

**Keep-forever.** Every other document touched by this PR was pruned or rewritten to
describe only the living system; this one is the exception. Once `SIMPLIFICATION.md`
and the deleted subsystems' own docs are gone, this ADR is the only record left in the
tree of what this repo used to be. Do not delete it, and do not edit its inventory to
match a later change — record that change in a new ADR instead.

## Context

A measured footprint audit of the running cluster found that the product this repo
exists to serve — the wall panel — was **~4% of it**. Kubernetes plus Temporal plus the
observability stack cost roughly **4.3 GB of RAM** before the product rendered a single
pixel. Temporal alone cost about **4x the product's own footprint** to run what amounted
to one daily row-delete, now a five-line worker cycle
(`features/weather/worker.ts`'s `weather-purge`).

Most of what was running had no relationship to the panel at all: a second product
(`dont-text-your-ex`), an in-house CI/agent platform (software-factory), a media server
(Plex) that existed for one GPU workload, a database admin UI, a camera-relay service, a
sandboxed code-execution environment, a UniFi Pulumi project for LAN device management,
and fifteen panel features that had a tile but no one using it. Each of these carried its
own namespace, its own database, its own secrets, and its own share of the docs — most of
which existed to explain systems nobody needed explained anymore.

## Decision

Delete all of it in one PR (`simplify` branch, merged here) rather than an incremental
trickle, because a trickle leaves each deletion under-explained: a `bd`/beads ticket
closed six months ago does not tell the next reader why a table is gone. One PR gets one
inventory and one rationale, written once, while the deletions are still fresh enough to
get right.

**The rule for what stayed**: the panel, its API, its background reconciliation, and the
Kubernetes substrate that actually keeps those three running (Talos, Postgres via CNPG,
cert-manager, metallb, the observability stack, cloudflared). Everything else — every
product that was not the panel, every mechanism that existed to run or track work on
other mechanisms, every feature whose tile nobody opened — went.

Net effect: **1690 files changed, -228,539 lines** (`git diff --stat
origin/main...simplify`). Roughly 73% of the repo, and prod's steady-state memory
footprint dropped from ~11.2 GB to roughly 3.5 GB.

## What was removed

### Whole products and services

- **`dont-text-your-ex`** — a second product living in this repo, with its own Temporal
  namespace, CNPG cluster, and pg-backup cron.
- **Software Factory** — the in-house agent/CI platform this repo previously deployed
  (its source lived in a sibling repo; this repo owned only the release lock and
  deployment). Ticket tracking went with it and has **no replacement** — there is no
  tracker in this repo anymore.
- **Temporal** — the workflow engine (server, worker, per-feature `temporal.ts` /
  `workflows.ts` / `activities.ts` facets, and their codegen). Every recurring job it ran
  was either deleted with its feature or rewritten as a plain interval Worker Cycle
  (`weather-purge` is the example that mattered).
- **The durable job queue** (`job` table, the `jobs.ts` facet convention, queue worker
  infrastructure in `apps/api`/`apps/worker`) — zero remaining users once weather's purge
  moved to a worker cycle.
- **Plex + NVIDIA** — a media server and the GPU device plugin/kernel extensions that
  existed only to transcode for it.
- **db-ui** (pgAdmin) — a database admin UI with its own namespace and PVC.
- **go2rtc** — a camera-relay service, used only by the deleted `dogcam` feature.
- **agent-sandbox + kata** — a VM-isolated code-execution environment and the Kata
  Containers Talos extension it required.
- **webhook-relay** — a standalone GitHub webhook receiver, superseded by nothing (the
  `hooks` feature it fed is also gone).
- **The UniFi Pulumi project** (`infra/unifi/`) — LAN device management as a separate
  Pulumi project; the UniFi controller's Manage tool row went with it (ADR-0010).
- **map-provision** — a basemap tile provisioner, the only consumer of `maplibre-gl`;
  died with the Tesla feature it existed for.
- **Storybook** — the component workshop app, all 160 `*.stories.tsx` files, and its
  vitest project. This repo is Storybook-first no longer; component work ships without
  a story.

### Fifteen features, deleted outright

`deploys` · `dogcam` · `felogs` · `goals` · `guest-wifi` · `hooks` · `injections` ·
`network` · `notif` · `panel-update` · `scenes` · `temporal-health` · `tesla` · `tv` ·
`weight`

Each took its owned tables, its worker cycles, and (where it had one) its Settings page
with it. `guest-wifi` was the captive portal (the guest WiFi listener, the guest static
bundle, `docs/captive-portal/`, and the ADR that folded it into this repo — ADR-0006,
also deleted by this PR). `tesla` took `apps/web/src/lib/maps/` and `maplibre-gl` but
**not** the Tesla climate-entity filter in `features/ac/service.ts` — the car keeps
reporting to Home Assistant after its tile is gone, so the filter that excludes its
climate entity from the house list survives as a constant.

### The lock screen and most of Settings

`LockScreenOverlay` and its two settings are gone; `DimOverlay` is now unconditional.
Settings shrank from 9 pages to 4 (Device, Display, Security, Time) and from 17 synced
fields to 3 (`pinCode`, `accent`, `timeZone`). Idle dim, active brightness, and the
typeface are hardcoded constants now, not settings.

### Detail pages, tiles kept as faces

Weather Now, Next 12 Hours, Climate · A/C, and Clock lost their detail views (sun arc,
thermal map, timer/stopwatch/alarm, …) and became face-only tiles — the board shrank
from 23 tiles to 8. Upcoming was deleted entirely, tile and all; `features/events`
survives only as the clock face.

### The 26 dropped database tables

`actual_injection`, `injection_check_in`, `injection_photo`, `injection_vial`,
`injection_course`, `injection_settings`, `goal_checkin`, `goal_schedule`,
`goal_vacation`, `goal`, `scene_run`, `scene`, `github_run_log_tail`, `github_run`,
`github_poll_status`, `events`, `portal_authorization`, `portal_rate_limit`,
`incoming_webhook`, `notification`, `device_push_token`, `frontend_log`,
`weight_measurement`, `withings_oauth_token`, `asc_build_status`, `job` — dropped by
migration `0039_the_simplification_drop_tables.sql`. Nine tables survive: `settings`,
`device_settings`, `lamp_mode`, `booth_photo`, `wake_photo`, `weather_reading`,
`weather_daily_reading`, `device_state`, `integration_sync_status`.

### Deleted `infra/` modules

`infra/src/temporal.ts`, `infra/src/temporal-constants.ts`, `infra/src/nvidia.ts`,
`infra/src/db-ui.ts`, `infra/src/agent-sandbox.ts`, `infra/src/kata.ts`,
`infra/src/webhook-relay.ts`, `infra/src/software-factory.ts`,
`infra/src/dont-text-your-ex.ts`, and the `infra/unifi/` and `infra/dont-text-your-ex`
Pulumi (sub-)projects. `infra/Pulumi.prod.yaml` (the retired Mac mini's stack config)
was also deleted; the mini itself was already retired and powered off before this PR and
is unaffected by it.

## What survives, unchanged

The lamp reconciliation loop (`light-enforcer`/`device-sync`/`party-mode`), the
climate enforcer, weather ingest, `packages/core`'s `device_state` store and
its five writers, Home Assistant, Loki/Grafana/Prometheus, cloudflared, CNPG,
cert-manager, metallb, and TestFlight-via-fastlane (`ios-build.yml` + the App Store
Connect secrets) are all untouched by this PR. (There is no Sonos-volume enforcer:
`features/sound/worker.ts` registers zero cycles — that was already true on
`origin/main`, not something this PR changed.)

## Recoverability

None of this is actually lost. Every deleted subsystem — code, infra declarations, and
docs — is recoverable from git history at the commit before this PR merged. Every
deleted `secrets/vault.yaml` key is recoverable the same way: the vault is SOPS-encrypted
*in git*, not out of it, so a removed key's ciphertext stays in history and decrypts with
the same age key for as long as that key exists. Deleting a vault key here does **not**
revoke the credential upstream (Spotify, Withings, APNs, the GitHub App); that is a
separate manual pass, if wanted.

What this PR actually protects against losing is not the code — it is the *explanation*.
The code was always one `git log` away. The reasoning for why each piece existed, and why
it stopped being worth running, was scattered across a dozen docs about to be deleted for
describing systems that no longer exist. This ADR is that reasoning, kept in the one
place a future reader — human or agent — will still be looking.
