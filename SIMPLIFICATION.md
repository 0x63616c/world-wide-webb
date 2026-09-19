# The Simplification

One PR. Deletes roughly 73% of this repo (~186,000 lines to ~50,000) and takes the
board from 23 tiles to 8.

This document is the spec AND the acceptance test. Part 1 is what to delete and
change. Part 2 is a checklist a second agent runs against the finished branch to
confirm it actually happened. Nothing in Part 2 should require trusting Part 1 —
every item is independently checkable from the working tree or the live cluster.

**Branch:** `simplify` · **Base:** `origin/main`

---

## 0. Before anything

- [x] Trigger the `pg-backup` CronJob by hand and confirm a fresh dump landed on the
      NAS under `/volume1/Homelab/backups/world-wide-webb/control-center/postgres`.
      **Done 2026-09-19** — job `pg-backup-presimplify` succeeded, logged
      `wrote /backup/control_center-20260919.sql.gz`.
- [x] Confirm photo booth + wake photos need no action: `MEDIA_STORAGE_DIR` is an NFS
      mount onto the Synology (`subPath: media`), not a PVC. Photos are already off-cluster.
- [x] `dont-text-your-ex` data is disposable — explicitly no backup required.
- [x] Capture `kubectl get pods,pvc,svc -A` output for reference before teardown.
      **Done 2026-09-19** — 163 lines captured to the session scratchpad.

---

# Part 1 — What goes

## 1. Whole products and services

| Thing | Paths |
|---|---|
| **dont-text-your-ex** | `apps/dont-text-your-ex/` (25,291 lines), `infra/src/dont-text-your-ex.ts`, `infra/test/dont-text-your-ex.test.ts`, `.github/workflows/dont-text-your-ex-ios.yml`, `scripts/test-dtye-temporal-contract.sh`, its 3 workspace entries in root `package.json`, `dev:dont-text-your-ex` + `build:dont-text-your-ex` scripts. Namespace, CNPG cluster, pg-backup cron, Temporal namespace all torn down. |
| **Software Factory** | `infra/src/software-factory.ts`, `infra/software-factory-release.json`, its CI provenance/digest validation in `.github/workflows/ci.yml`, `scripts/software-factory-release-manifest.sh`, `scripts/verify-software-factory-release.sh`, `scripts/test-software-factory-*.sh` (3), `scripts/test-no-embedded-software-factory.sh`, `scripts/create-ticket.sh`, the `create-ticket` and `grind-tickets` skills, `docs/beads-archive/`. All 6 `softwareFactory.*` secrets. |
| **Temporal** | `infra/src/temporal.ts`, `infra/src/temporal-constants.ts`, `apps/temporal-worker/` + its Dockerfile + CI build job, `packages/temporal-runtime/`, every `features/*/temporal.ts` + `workflows.ts` + `activities.ts`, `features/_generated/{workflows,activities,schedules}.gen.ts` and their codegen in `scripts/apps-gen/`, `docs/adr/0008-*`, `@temporalio/*` deps. |
| **Plex + NVIDIA** | `plex` workload in `infra/src/services.ts`, `plex-config` PVC, `infra/src/nvidia.ts`, the nvidia device plugin, and the `nonfree-kmod-nvidia-production` / `nvidia-container-toolkit-production` extensions + `nvidia*` kernel modules in `infra/talos/talconfig.yaml`. |
| **db-ui** | `infra/src/db-ui.ts`, `pgadmin-data` PVC, namespace. |
| **go2rtc** | workload in `infra/src/services.ts` + its proxy in `apps/web/vite.config.ts`. |
| **agent-sandbox + kata** | `infra/src/agent-sandbox.ts`, `infra/src/kata.ts`, `siderolabs/kata-containers` extension in `talconfig.yaml`. |
| **webhook-relay** | `infra/src/webhook-relay.ts` + namespace. |
| **UniFi Pulumi project** | `infra/unifi/` (whole project), `scripts/push-unifi-names.sh`, its workspace entry. |
| **map-provision** | `apps/map-provision/` + Dockerfile + CI job, `map-extract` CronJob, `maps` PVC. Dies with Tesla — it is the only maplibre consumer. |
| **Storybook** | `apps/storybook/`, `apps/web/.storybook/`, **all 195 `*.stories.tsx` / `*.stories.test.tsx` files (19,653 lines)**, the storybook vitest project, `test:storybook` script, `scripts/check-storybook-docs.sh` + `scripts/test-check-storybook-docs.sh`, the `storybook-docs` lefthook hook, `@storybook/*` + `storybook` deps. |

⚠️ Removing the nvidia and kata Talos extensions changes the machine config schematic
and **reboots the node**. Sequence it deliberately.

## 2. Features deleted outright (15)

`deploys` · `dogcam` · `felogs` · `goals` · `guest-wifi` · `hooks` · `injections` ·
`network` · `notif` · `panel-update` · `scenes` · `temporal-health` · `tesla` · `tv` ·
`weight`

Delete `features/<id>/` entirely, then re-run `bun run apps:gen`.

Each drags out its backing:

- **deploys** — `github_run`, `github_run_log_tail`, `github_poll_status` tables; `github-actions-poll` worker cycle; `GITHUB_ACTIONS_TOKEN`, `GITHUB_REPO`.
- **dogcam** — go2rtc; `CAMERA_LABEL`, `CAMERA_STREAM_NAME`, `GO2RTC_URL`.
- **felogs** — `frontend_log` table; **`apps/web/src/lib/log/` (2,144 lines)**; the `logs.ingest` tRPC mutation; `apps/web/src/components/logs/` (974); `settings-page/pages/LogsPage.tsx`; the native diagnostics feeding it (`KioskDiagnosticsPlugin.swift`, `PanelMetricKitCollector.swift`, `PanelDiagnosticsModels.swift`).
- **goals** — `goal`, `goal_schedule`, `goal_checkin`, `goal_vacation` tables; the `goalDayCutoffHour` setting.
- **guest-wifi** — `portal_rate_limit`, `portal_authorization` tables; the guest HTTP listener; `features/guest-exposed.ts`; `features/_generated/guest-router.gen.ts`; the `GUEST_EXPOSED` codegen validator rule; **the entire captive portal**: `apps/web/src/portal/` (2,222), `apps/web/e2e-portal/`, `vite.portal.config.ts`, `portal.html`, the portal TLS Certificate in `infra/src/certmanager.ts`; `docs/captive-portal/`; `docs/adr/0006-*`; `wifiGuest` + `captivePortal` secrets.
- **hooks** — `incoming_webhook` table; `GITHUB_BOT_WEBHOOK_SECRET`; the whole `githubBot` secret set (6 keys); `scripts/create-github-bot-app.ts`, `scripts/rotate-github-bot.sh`, `scripts/save-github-bot.sh`, `docs/github-bot.md`.
- **injections** — `injection_course`, `injection_vial`, `actual_injection`, `injection_check_in`, `injection_photo`, `injection_settings` tables.
- **network** — `settings-page/pages/NetworkPage.tsx`; `UNIFI_*` env; `WIFI_SSID` / `WIFI_PASSWORD` / `WIFI_GUEST_SSID`.
- **notif** — `notification`, `device_push_token` tables; `settings-page/pages/NotificationsPage.tsx`; `components/NotificationBridge.tsx`, `components/PushRegistrar.tsx`, `components/NotChargingBanner.tsx`; the `pushEnabled` setting; all 3 `apns` secrets; `@capacitor/push-notifications`.
- **panel-update** — `asc_build_status` table; `asc-version-poll` worker cycle; `components/AppUpdateBanner.tsx`. ⚠️ The 3 App Store Connect secrets **STAY** — `ios-build.yml` + fastlane still ship to TestFlight.
- **scenes** — `scene`, `scene_run` tables; Spotify (see §4).
- **tesla** — **`apps/web/src/lib/maps/`, `maplibre-gl`, `apps/map-provision/`, the `map-extract` cron, the `maps` PVC**; `HOME_PLACE_NAME`, `HOME_RADIUS_MILES`.
- **tv** — the `/media/tv-artwork` HA artwork proxy.
- **weight** — `weight_measurement`, `withings_oauth_token` tables; `withings-weight-ingest` worker cycle; both `withings` secrets; `components/tiles/Weight*.tsx`.

### ⚠️ The Tesla trap

`features/ac/service.ts:107` and `:379` use `TESLA_ENTITY_PREFIX` to **exclude** the
car's climate entity from the house climate list. The car keeps reporting
`climate.<prefix>_*` to Home Assistant after the tile is gone. **The filter must
survive** — collapse the env var to a constant, do not delete the filter, or the A/C
tile starts showing the car.

## 3. Facet conventions deleted

Both have zero remaining users and their whole mechanism goes:

- **`jobs.ts`** — after weather's purge moves to a worker cycle. Delete the `job`
  table, the durable queue infrastructure in `apps/api`, the queue workers in
  `apps/worker`, `features/_generated/jobs.gen.ts`, and its codegen.
- **`temporal.ts`** — see §1.

## 4. Sound: Spotify out, Sonos stays

Delete `features/sound/spotify-service.ts`, `spotify-browse.test.ts`,
`web/SpotifyModal.tsx`, `web/QuickPlayTile.tsx`, `web/QuickPlayTileView.tsx`,
`web/wiring/quickplay.tsx`, the `tile_quickplay` tile, all 3 `spotify` secrets, and
`scripts/spotify-oauth.ts`.

Keep `sonos-sound-system-service.ts`, `sonos-write-service.ts`,
`web/SoundSystemTileView.tsx`, `web/GroupsModal.tsx`, `web/hooks/useMixer.ts`,
`web/hooks/useThrottledVolume.ts`, and the `sonos-volume-enforcer` worker cycle.

**Keep the `sourceKind: "spotify"` branch** in `sonos-sound-system-service.ts` — it
string-matches the Sonos group's URI to label what's playing. It is not a Spotify API
call and works with zero credentials.

## 5. Detail pages deleted (tiles survive as faces)

| Tile | What goes |
|---|---|
| Weather Now | sun arc, 7-day outlook, comfort — the whole detail (`features/weather/web/views/`, 3,751) |
| Next 12 Hours | whole detail |
| Climate · A/C | zones, thermal map, presets (`features/ac/web/views/`, 2,319) |
| Clock | timer, stopwatch, alarm, world clocks, countdown horizon (`features/events/web/clock/` 1,732 + `views/` 2,697) |

Cascades: **`apps/web/src/lib/time-suite/` (1,931)**, `components/TimeSuiteBanner.tsx`,
its `lib/store.ts` slices, and the "ringing alarm counts as bounded activity" branch in
`lib/panel-session/`.

**Upcoming** is deleted entirely — tile, the 6 `EventsModal*` views, the `events` table,
and its api. `features/events/` survives as the clock face only (greeting, seconds ring).

### ⚠️ Codegen invariant change — must land before the above

`scripts/apps-gen/validate.ts` currently requires **exactly one** Tile View per Tile.
Face-only tiles need **zero or one**. Change `app-kit` + the validator + the Tile Detail
Host + `accessFor()` accordingly.

### ⚠️ Home tile

`tile_clock` is the only `home: true` tile and it becomes face-only. **Move `home: true`
to `tile_ctrl` (Controls)** — it keeps a detail view, so glide-home lands somewhere
actionable.

## 6. Frontend simplification

**Board** — delete `components/Minimap.tsx`, `MinimapView.tsx`, and **all 5 snap modes**
from `lib/board-camera/`. Keep pointer pan + glide-home only.

**Lock screen** — delete `components/LockScreenOverlay.tsx`, the `lockScreenEnabled` and
`lockScreenBlurPercent` settings, both Security-page controls, and the branch in
`Board.tsx`. `DimOverlay` becomes unconditional:

```tsx
<DimOverlay active={sessionPhase === "ended"} />
```

**PIN is unaffected** — `pinCode` stays editable on the Security page, and the
session-end relock stays. Photo Booth (`private`) and Activity (`sensitive`) remain
gated.

**Settings: 9 pages → 3.**

| Page | Fate |
|---|---|
| Board | **deleted** — snap + minimap were all it held |
| Network | **deleted** |
| Notifications | **deleted** |
| Sound | **deleted** — volume is always 100 |
| Logs | **deleted** |
| Display | keeps **accent** only |
| Device | keeps device name; loses the Build section + developer overlay |
| Time | keeps time zone; loses panel maintenance + goal day cutoff |
| Security | keeps **PIN only**; loses keypad layout (fixed only) |

**Settings fields deleted (13 of 17):** `activeBrightness`, `idleDimEnabled`,
`idleDimTimeoutMs`, `idleDimLevel`, `showFps`, `showBuildBadge`, `showBuildNumber`,
`snapMode`, `showMinimap`, `pinPadLayout`, `typeface`, `goalDayCutoffHour`,
`pushEnabled`, plus `lockScreenEnabled` + `lockScreenBlurPercent`.

**Surviving:** `pinCode`, `accent`, `timeZone`, device name.

**Hardcoded:** idle dim **on**, **60000ms**, level **30**. Typeface **SF Pro**
(delete `lib/typeface.ts`'s alternatives + the selector).

**Also deleted:** `components/DevOverlayHud.tsx`, `components/FpsSparkline.tsx`,
`components/AppUpdateBanner.tsx`, `components/NotChargingBanner.tsx`,
`components/TimeSuiteBanner.tsx`.

**Kept:** `MobileBoard.tsx` + `lib/mobile.ts` + `lib/useIsNarrow.ts`, `PanelFrame.tsx`,
the accent color, the sound bus (`playCue()`).

**Controls relabel:** saved lamp colors become **"Edit custom 1 / 2 / 3"**, not
"Edit red / blue / custom".

**Native (Swift):** delete `PanelMaintenancePlugin.swift` (nightly WebKit refresh),
`PanelVolumePlugin.swift`, `KioskDiagnosticsPlugin.swift`, `PanelMetricKitCollector.swift`,
`PanelDiagnosticsModels.swift`. Keep `UISoundPlugin.swift` (the sound bus),
`KioskBrowserPlugin`, `KioskHealth`, `KioskViewController`, `KioskWatchdog`.
Drop `@capacitor-community/screen-brightness`, `@capacitor/push-notifications`.

## 7. Database

**Drop 19 tables:** `github_run`, `github_run_log_tail`, `github_poll_status`, `events`,
`goal`, `goal_schedule`, `goal_checkin`, `goal_vacation`, `portal_rate_limit`,
`portal_authorization`, `incoming_webhook`, `notification`, `device_push_token`,
`frontend_log`, `injection_course`, `injection_vial`, `actual_injection`,
`injection_check_in`, `injection_photo`, `injection_settings`, `scene`, `scene_run`,
`weight_measurement`, `withings_oauth_token`, `job`.

**Keep 11:** `settings`, `device_settings`, `lamp_mode`, `booth_photo`, `wake_photo`,
`weather_reading`, `weather_daily_reading`, `device_state`, `device_commands`,
`integration_sync_status`.

## 8. Secrets

**Delete from `secrets/vault.yaml`, `packages/platform/src/index.ts` `secretCatalog`,
`infra/src/secrets-map.ts`, and `packages/platform/env/manifest.ts`:**
`captivePortal.*`, `softwareFactory.*` (6), `githubBot.*` (6), `apns.*` (3),
`spotify.*` (3), `withings.*` (2), `unifi.*`, `wifiGuest.*`, `wifiMain.*`,
`homeLocation.placeName`, `homeLocation.radiusMiles`.

**Keep:** `homeAssistant.token`, `controlCenter.postgresPassword`,
`cloudflare.managedTunnelToken`, `homeLocation.lat`/`lon`, `appStoreConnect.*` (CI),
and **`github.ghcrPat`**.

> ⚠️ **Correction (2026-09-19).** An earlier draft of this section listed
> `github.ghcrPat` as "delete if unused after SF removal — verify". It is **used** and
> **must stay**: `infra/src/services.ts:819` mints the GHCR image-pull secret from
> `GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN`, so every app image pull breaks without it.
> `scripts/save-ghcr-pull-token.sh` stays with it. Do not re-delete this.

**Recoverability.** `secrets/vault.yaml` is SOPS-encrypted *in git*, so any key removed
here stays recoverable from history for as long as the age key that decrypts it exists —
nothing in this PR touches that key. Removing a vault key also does **not** revoke the
credential upstream; revoking at the provider (Spotify, Withings, APNs, the GitHub App)
is a separate manual pass after merge, if wanted.

**Rule for every deletion in this section:** a secret only goes once its consumer is
deleted in this same PR *and* a repo-wide grep for the vault key name returns zero
non-test hits.

**Delete the matching save scripts:** `save-spotify-credentials.sh`, `save-wifi-guest.sh`,
`save-synology-dsm.sh` (verify), `save-openrouter.sh`, `save-resend.sh`,
`save-cf-access-tokens.sh` (verify).

## 9. Cloudflare

Prune adopt-only routes in `infra/cloudflare/src/routes.ts` + `access.ts` (and their
tests) for: `db-ui`, `plex`, all software-factory hostnames, all dont-text-your-ex
hostnames. This will not fall out of the Pulumi delete — it needs a deliberate pass.

## 10. Scripts (~92 → ~50)

**Delete — retired Mac mini era:** `orbstack-watchdog.sh`, `install-orbstack-watchdog.sh`,
`test-orbstack-watchdog.sh`, `provision-orbstack.sh`, `install-haos.sh`, `ha-watchdog.sh`,
`install-ha-watchdog.sh`, `test-ha-watchdog.sh`, `serve-with-watchdog.sh`,
`lib/watchdog-decide.sh`, `drift-check.sh`, `install-drift-check.sh`,
`storage-migration/` (3), `ssh-homelab.sh`.

**Delete — completed one-time cutovers:** `cc-cutover-preflight.sh`,
`cc-cutover-semantic-checks.sql`, `cc-post-cutover-smoke.sh`,
`test-cc-cutover-preflight.sh`, `test-cc-post-cutover-smoke.sh`,
`cnpg-local-name-preflight.sh`, `test-cnpg-local-name-preflight.sh`.

**Delete — guards against things that no longer exist:** `scripts/check-no-<retired-scheduler>.sh`
(the guard blocks spelling its own subject, so it is named obliquely here — it is the only
`check-no-*.sh` script matching that shape, and it guards against a Docker Swarm era
scheduler this repo has not used in over a year),
`check-storybook-docs.sh`, `test-check-storybook-docs.sh`, `check-rename-identity.py`,
`rename-identity-allowlist.tsv`, `test-check-rename-identity.sh`.

**Delete — UniFi flow analysis:** `unifi-enrich-flows.py`, `unifi-flow-report.py`,
`unifi-flow-report.sh`, `unifi-rotate-netflow.sh`, `unifi-syslog-ng.conf`,
`setup-unifi-log-receivers.sh`, `configure-unifi-log-export.sh`.

## 11. Lefthook

**Delete hooks:** `storybook-docs`, and the retired-scheduler guard hook described in §10.
**Keep:** `format`, `no-inline-ids`, `no-home-address`, `no-personal-email`,
`no-plaintext-secrets`, `worktree-guard`, `gitleaks`, `biome-lint`, `knip-deadcode`.

Also drop the `identity:audit` script from root `package.json`.

## 12. Docs

**Delete:** `docs/captive-portal/`, `docs/platform/`, `docs/k3s-migration/`,
`docs/beads-archive/`, `docs/superpowers/`, `docs/prototypes/`, `docs/media-tiles/`,
`docs/media/`, `docs/evidence/`, `docs/screenshots/`, `docs/assets/`, `docs/archive/`,
**`docs/writing-scalable-typescript/`**, `docs/homelab-host.md`, `docs/ha-homelab.md`,
`docs/m9-pulumi-migration.md`, `docs/plex.md`, `docs/github-bot.md`,
`docs/unifi-logging.md`, `docs/secrets-sops-migration/`, `docs/perf-lab-recommendation.md`,
`docs/dashboard-spec.md`, `docs/acceptance-checklist.md`, `docs/design/`, `docs/plans/`,
`docs/specs/`.

**Prune `docs/adr/`** hard — delete ADRs for deleted subsystems (0006 guest-wifi,
0008 Temporal, 0010 manage-registry if manage's design changes, 0011/0012
software-factory). Keep only what still describes the living system.

**Keep:** `docs/observability.md`, `docs/runbooks/` (prune), `docs/hardware-inventory.md`,
`docs/logging.md` (rewrite — the frontend half is gone).

**Rewrite from scratch at the end:** `AGENTS.md`, `CLAUDE.md`, `CODEBASE_OVERVIEW.md`,
`CONTEXT.md`, `README.md`. The existing AGENTS.md is majority rules about deleted things.

### 12a. The Simplification ADR — the one thing this PR must ADD to `docs/adr/`

The PR does not finish until it adds a permanent ADR at the next free number in
`docs/adr/` (**`0013-`** — `0008`, `0011` and `0012` were Temporal and
software-factory ADRs deleted by this PR, so those numbers are burned and must not be
reused), titled **"The Simplification: what was deleted and why"**.

Unlike every other doc touched here, this one is **keep-forever**. It is the only
record left in the tree of what this repo used to be, once `SIMPLIFICATION.md` and the
deleted subsystems' own docs are gone. It must:

- **List every subsystem removed**: the products (`dont-text-your-ex`, software-factory,
  Plex, db-ui, go2rtc, agent-sandbox/kata, webhook-relay, map-provision, the UniFi
  Pulumi project), Temporal, the durable job queue, the 15 features, Storybook, the lock
  screen, the six deleted settings pages, the 25 dropped DB tables, and the deleted
  `infra/` modules.
- **State why.** The measured footprint said the product was a rounding error: the panel
  itself was **~4%** of it. Kubernetes plus Temporal plus the observability stack cost
  **~4.3 GB** of RAM before the product rendered a single pixel. Temporal alone cost
  roughly **4x the product's own footprint** to run what amounted to one daily
  row-delete — which is now a worker cycle.
- **Note that none of it is lost**: every deleted subsystem is recoverable from git
  history at the commit before this PR merged, including `secrets/vault.yaml` keys
  (SOPS-encrypted in git, still decryptable with the unchanged age key).

Write it last, once the deletions have settled, so its inventory matches what actually
happened rather than what was planned.

## 13. Also delete

- `apps/web/src/components/concepts3/` (3,467) — design concepts shipped in the bundle.
- `infra/Pulumi.prod.yaml` — the retired-mini stack whose cloudflared would split-brain
  the live tunnel.
- `apps/manage/src/registry.ts` — prune 14 tools to ~9: drop **Plex, pgAdmin, Software
  Factory, UniFi, Temporal**. Keep Control Center, Home Assistant, Grafana, Cloudflare,
  Zero Trust, Pulumi, Tailscale, Synology, GitHub. Regenerate
  `apps/manage/src/extension-rules.ts`.

## 14. What must NOT break

- `light-enforcer` / `device-sync` / `party-mode` (1s, 1s, 2s) — the lamp
  reconciliation loop. Untouched by any of this.
- `climate-enforcer`, `sonos-volume-enforcer`.
- `weather-ingest`, plus the **new** `weather-purge` worker cycle replacing
  `WeatherPurgeWorkflow`.
- Home Assistant, Loki/Grafana/Prometheus, cloudflared, CNPG, cert-manager, metallb,
  openebs-lvm.
- `ios-build.yml` + fastlane + App Store Connect secrets — TestFlight is the only
  release channel.
- `packages/core` `device_state` and its five writers.

---

# Part 2 — Verification checklist

Run against the finished `simplify` branch. Each item is independently checkable.
`rg` = ripgrep, run from the repo root. Expected result is stated for every check.

## Build and gates

- [ ] `bun install` succeeds with no unmet peer/workspace errors.
- [ ] `bun run typecheck` passes.
- [ ] `bun run lint` passes.
- [ ] `bun run test` passes; **no test is skipped or deleted to make it pass** — confirm
      the count dropped only in proportion to deleted features.
- [ ] `bun run knip` passes with an empty report (it was clean before; it must stay clean).
- [ ] `bun run apps:check` passes — codegen is in sync and committed.
- [ ] CI is green on the PR.

## Structure

- [ ] `ls apps/` shows exactly: `api`, `manage`, `web`, `worker`. No `storybook`,
      `temporal-worker`, `map-provision`, `dont-text-your-ex`.
- [ ] `ls features/` shows exactly: `_generated`, `ac`, `booth`, `ctrl`, `events`,
      `sound`, `wakes`, `weather`, plus `tsconfig.json`. **No `guest-exposed.ts`.**
- [ ] `ls packages/` — no `temporal-runtime`.
- [ ] `find . -name 'Dockerfile*' -not -path '*/node_modules/*'` returns exactly 4:
      api, manage, web, worker.
- [ ] `ls .github/workflows/` returns exactly `ci.yml` and `ios-build.yml`.
- [ ] Root `package.json` workspaces contain no `dont-text-your-ex` or `infra/unifi` entry.
- [ ] `ls infra/` — no `unifi/`, no `Pulumi.prod.yaml`.

## Nothing left behind (all must return ZERO hits)

- [ ] `rg -il 'temporal' --glob '!node_modules' --glob '!bun.lock'`
- [ ] `rg -il 'dont-text-your-ex|dontTextYourEx'  --glob '!node_modules'`
- [ ] `rg -il 'software-factory|softwareFactory' --glob '!node_modules'`
- [ ] `rg -il 'spotify' --glob '!node_modules'` — **except** the `sourceKind`
      URI-matching branch in `features/sound/sonos-sound-system-service.ts`, which is
      expected and correct.
- [ ] `rg -il 'withings|maplibre|go2rtc|pgadmin|agent-sandbox|kata|orbstack|homelab|k3s' --glob '!node_modules'`
- [ ] `rg -il 'lockScreen|showMinimap|snapMode|pinPadLayout|goalDayCutoffHour|pushEnabled|showFps|showBuildBadge|activeBrightness|idleDimEnabled' --glob '!node_modules'`
- [ ] `rg -l 'stories' --glob '*.stories.tsx' --glob '*.stories.test.tsx'` — **zero files.**
- [ ] `rg -il 'storybook' --glob '!node_modules' --glob '!bun.lock'`
- [ ] `rg -il 'unifi|captive.?portal|frontend_log|incoming_webhook' --glob '!node_modules'`
- [ ] No `features/*/jobs.ts`, no `features/*/temporal.ts`, no `features/*/workflows.ts`,
      no `features/*/activities.ts`.
- [ ] No `features/_generated/{jobs,workflows,activities,schedules,guest-router}.gen.ts`.

## The board

- [ ] `features/_generated/tiles.gen.ts` contains **exactly 8 tiles**: `tile_clock`,
      `tile_ctrl`, `tile_ac`, `tile_weath`, `tile_hourly`, `tile_booth`, `tile_wakes`,
      `tile_sound`.
- [ ] **Exactly one** tile has `home: true`, and it is **`tile_ctrl`**.
- [ ] `tile_booth` has `private: true`; `tile_wakes` has `sensitive: true`; every other
      tile has both `false`.
- [ ] No tile has `guestExposed: true`.
- [ ] `tile_clock`, `tile_ac`, `tile_weath`, `tile_hourly` resolve to **zero** Tile
      Views in `web.gen.ts`; `tile_ctrl`, `tile_booth`, `tile_wakes`, `tile_sound`
      resolve to exactly one each.
- [ ] No overlapping tile rects (the validator enforces this — confirm it still runs).

## Correctness traps

- [ ] **The Tesla climate filter survives.** `features/ac/service.ts` still excludes
      `climate.<tesla-prefix>*` entities from the house climate list — now via a
      constant, not `config.TESLA_ENTITY_PREFIX`. Verify both call sites
      (was `:107` and `:379`). **If this is gone, the A/C tile will show the car.**
- [ ] **The weather purge survived the Temporal deletion.** `features/weather/worker.ts`
      declares a `weather-purge` cycle. Confirm it actually deletes old rows, and that
      `WeatherPurgeWorkflow` no longer exists anywhere.
- [ ] **The lamp loop is untouched.** `features/ctrl/worker.ts` still declares
      `light-enforcer` (1000ms), `device-sync` (1000ms), `party-mode` (2000ms), all
      `runOnStart: true`.
- [ ] **The Sonos volume enforcer survived** the Spotify removal.
- [ ] **PIN gating still works.** `pinCode` is settable on the Security page; opening
      Photo Booth prompts every time; opening Activity prompts once per session; the
      session-end relock still fires.
- [ ] **Idle dim is hardcoded correctly**: enabled, 60000ms, level 30 — and the panel
      still dims on timeout with `DimOverlay`, with no `LockScreenOverlay` in the tree.
- [ ] **App Store Connect secrets were NOT deleted** — `ios-build.yml` still resolves
      them. Deleting `panel-update` must not have taken them.
- [ ] `packages/core` `device_state` still has its five writers (light, climate,
      sonos-volume, device-sync, desired-state-store).

## Database

- [ ] A migration exists that drops all 25 listed tables.
- [ ] `features/_generated/schema.gen.ts` + `apps/api/src/db/schema.ts` compose to
      exactly the 11 keeper tables.
- [ ] Migrations run clean against a fresh database AND against a copy of the production
      dump.

## Secrets

- [ ] `bun run test` in `packages/platform` passes — `infra/test/secrets-derivation.test.ts`
      is a golden snapshot and **must have been updated deliberately**, not deleted.
- [ ] `scripts/check-sops-encrypted.sh` passes on `secrets/vault.yaml`.
- [ ] Every remaining `secretCatalog` entry has a live consumer: grep each vault key name
      and confirm at least one non-test hit.
- [ ] **`github.ghcrPat` / `GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN` still exists** in
      `secrets/vault.yaml` and `secretCatalog`, and `infra/src/services.ts` still reads it
      for the GHCR image-pull secret. **If this was deleted, no app image can be pulled.**
- [ ] `appStoreConnect.*` (3 keys) still exist and `ios-build.yml` still resolves them.
- [ ] No secret VALUES appear anywhere in the diff.

## Cluster (post-deploy)

- [ ] `kubectl get ns` — no `temporal`, `software-factory`, `dont-text-your-ex`, `db-ui`,
      `agent-sandbox-system`.
- [ ] `kubectl -n control-center get pods` — exactly `api`, `worker`, `web`, `manage`,
      `control-center-postgres-1`, plus pg-backup jobs. No `plex`, no `go2rtc`,
      no `map-extract`.
- [ ] `kubectl get pvc -A` — no `plex-config`, `maps`, `pgadmin-data`, or any
      dont-text-your-ex / software-factory volume.
- [ ] `kubectl top nodes` shows roughly **3.5 GB** or lower, down from ~11.2 GB.
- [ ] Home Assistant, Grafana, Loki, Prometheus, cloudflared all still Running.
- [ ] The panel loads, all 8 tiles render live data, and lamp taps still take effect
      within ~1s.

## Docs

- [ ] `AGENTS.md`, `CLAUDE.md`, `CODEBASE_OVERVIEW.md` were **rewritten**, not patched —
      no lingering references to Temporal, software-factory, Storybook, beads, ticket
      tracking, the captive portal, or the `jobs.ts` / `temporal.ts` facets.
- [ ] `docs/` contains no directory listed as deleted in §12.
- [ ] Every ADR remaining in `docs/adr/` describes a subsystem that still exists.
- [ ] `docs/logging.md` no longer describes the frontend log pipeline.
- [ ] **The Simplification ADR exists** at the next free number in `docs/adr/`
      (`0013-`, not reusing `0008`/`0011`/`0012`), titled "The Simplification: what was
      deleted and why". It inventories every removed subsystem (products, Temporal, the
      job queue, the 15 features, Storybook, the lock screen, the settings pages, the
      dropped DB tables, the infra modules), states the footprint rationale (panel = ~4%
      of the measured footprint; k8s + Temporal + observability = ~4.3 GB before a pixel
      rendered; Temporal = ~4x the product to run one daily row-delete), and records that
      everything is recoverable from git history. It is keep-forever — it is NOT deleted
      with the rest of the docs.
- [ ] This file (`SIMPLIFICATION.md`) is deleted in the final commit, or explicitly kept
      as the record — state which.

## Final smell test

- [ ] `git diff --stat origin/main...simplify` shows roughly **-136,000 lines**.
- [ ] Total tracked lines are in the neighbourhood of **50,000**, down from ~186,000.
- [ ] Nothing in the diff is an *addition* that isn't one of: the codegen invariant
      change, the weather-purge cycle, the hardcoded idle-dim constants, the Tesla
      climate filter constant, the Controls relabel, the rewritten docs, or a migration.
