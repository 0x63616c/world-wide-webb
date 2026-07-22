# Consolidation Roadmap: one product, apps architecture, deep seams

> **Master roadmap** for the 2026-07-21 architecture review execution. This document records
> the decisions and track sequence. Each track gets its own detailed implementation plan
> (`docs/superpowers/plans/`) authored when the track starts — the codebase shifts too much
> between tracks for up-front task-level code to stay truthful. Track 0's plan:
> `2026-07-21-track-0-product-merge.md`.

**Goal:** Collapse the two-product repo into a single control-center system, then execute the
apps re-architecture (ADR-0001/0002/0005) plus the eight deepening candidates from the
2026-07-21 architecture review.

## Decisions (grilled and locked, 2026-07-21)

| # | Decision | Choice |
|---|----------|--------|
| 1 | C3 platform duplication | Shrink manifest to the 4 consumed facets (exposure, database, backup, secretUsages); `infra/src/services.ts` stays the single workload declaration |
| 2 | `packages/core` birth scope | device-state store only; queue/HA/env/migrator pulled down lazily as app folds need them |
| 3 | Product merge | captive-portal product dissolves into control-center; portal becomes App `apps/guest-wifi/` |
| 4 | Guest API surface | Same image, **portal-only listener** (separate port/entrypoint mounting only the portal router + guest static page); guests structurally cannot reach the full router (ADR-0004: PIN is client-only) |
| 5 | Guest web | Shared UI: portal screens rebuilt on cc ui primitives + theme as a second tiny vite entrypoint; guests never download the board bundle |
| 6 | Hostnames | `app.worldwidewebb.co`; delete `${host}--${dnsCode}` flattening + dnsCode; retire `dashboard.worldwidewebb.co` after cutover; portal stays LAN-only (no CF hostname) |
| 7 | Portal Postgres | Verify `control_center` holds authoritative rows → final pg_dump to NAS → delete cluster, auth secrets, migration tooling |
| 8 | Merge sequencing | Track 0, fused with the platform prune — before all other tracks |
| 9 | Repo layout | **Flatten to root** in Track 0: `apps/`, `web/`, `api/`, `worker/` at repo root; `products/` dies; future products = separate repos |
| 10 | Device-state store seam | Interface + pg adapter + in-memory adapter + default prod instance; services take the store as a parameter |
| 11 | Repo (data-access) rollout | Per-App repo (PortalRepo pattern), each landing with its app fold; no big-bang |
| 12 | `createStore` home | `web/src/lib/store.ts` (single web app post-merge; promote later if a second consumer appears) |
| 13 | PIN Session semantics | One shared session covers all Sensitive surfaces; expires on the existing idle-reset; explicit close supported; client-only until Slice S (ADR-0004) |
| 14 | Snap modes | All 5 kept — user preference, not an experiment; board-camera module carries them behind its interface |
| 15 | C8 settings descriptors | In, as a late Track B slice after settings sits on `createStore` |
| 16 | First app fold | `guest-wifi` (already repo-seamed, clearly bounded, exercises sensitive/owned-tables/cron/guest-entrypoint machinery) |

## Track sequence

Every slice: green `bun run typecheck` + relevant tests, commit, push to `main` (deploys prod).
No long-lived branches. No big-bang.

### Track 0 — product merge, platform prune, repo flatten
Plan: `2026-07-21-track-0-product-merge.md`. Summary: docs/ADR first; guest bundle on cc ui;
portal-only listener; infra cutover (LAN LB → listener, delete captive-portal
workloads/namespace/images); delete `products/captive-portal/`; portal DB teardown
(verify → NAS dump → destroy); hostname cutover to `app.worldwidewebb.co`; platform prune
(dead unions, `services[].image`/`workloadName`, secret-lockstep merge, dnsCode); flatten
`products/control-center/*` to repo root.

### Track A — backend substrate
- **C1** (done): created `packages/core` with the device-state store (`readDesired` / `writeDesired` /
  `writeReported` / `readEffective`), owning the `device_state` table. Interface + pg +
  in-memory adapters + default instance (decision 10). Absorbs the 5 bypassing writers
  (climate/light/sonos-volume enforcers, device-sync, desired-state-store) and the 8 direct
  readers. The 4 enforcer test suites drop their hand-built drizzle `SelectChain` fakes.
- **C2**: per-App repos ride each app fold in Track C (decision 11).

### Track B — web
- Hygiene strip: delete ~4.6k lines of dead concept files (`concepts3/WorldConcepts`,
  `BoardVibeConcepts`, `BoardRedesignConcepts`, `ClimateHubConcepts`); rename
  `tiles/modals/` out of the Modal lie; delete the controls router double-catch (7
  occurrences, middleware already handles it); move cross-service identity constants
  (`CLIMATE_DEVICE_ID`, sonos topology) out of enforcers; fix stale guards
  (`registry-guards` 12×6 header, duplicated `WALL_THICKNESS`).
- **C4**: `createStore` primitive at `web/src/lib/store.ts`; refactor the 7 hand-rolled
  `useSyncExternalStore` singletons onto it.
- **C5**: pin-session module — one Unlock, shared session, idle-reset expiry (decision 13);
  `open-settings-store` deletes; `requiresPin` becomes the manifest `sensitive` flag.
- **C6**: board-camera module owning pointer refs, snap physics (all 5 modes), idle
  glide-home behind a small interface (`panTo` / `freeze` / `isSettling`).
- **C8**: settings field-descriptor table (late; after C4 settles).

### Track C — apps migration (ADR-0001/0002)
- **C7**: `app-kit` + `apps:gen` codegen + `_generated/` drift guard (land the guard early —
  parallel sessions), web facet first with lazy component refs (kills the MapLibre mock
  boilerplate in 18 test files and the two hand-kept 20-member unions).
- Fold features one slice each, starting with **guest-wifi**, then weather, weight, climate,
  controls, sonos, tesla, … (~19). Each fold: `apps/<id>/` folder (manifest, web, api, jobs,
  schema facets), per-App repo + in-memory fake, consistency test green.
- Central registries (`tile-registry.ts`, `appRouter` literal, `Worker[]` array, schema
  barrel, `worker-deps.ts`) delete when their last entry migrates.
- **Slice S** (ADR-0004): server-side PIN — `session.unlock(pin)`, `requireUnlock`
  middleware, `procedureFor(manifest)` gating, codegen guard. **Strictly last, strictly
  separate.**

## End state

Single product at repo root (`apps/`, `web/`, `api/`, `worker/`, `packages/`, `infra/`);
one Postgres (`control_center`); one worker deployable; panel at `app.worldwidewebb.co`;
guests at a LAN-only portal page built from cc components against a portal-only listener;
adding a feature = create `apps/<id>/` + `apps:gen`; deleting a feature = delete its folder;
tests reach modules through interfaces (in-memory store/repo adapters — no `vi.mock` of
db/HA singletons); one Unlock gating all Sensitive surfaces, server-enforced after Slice S.

## Standing risks

- Parallel Claude sessions push `main` constantly: land the `_generated/` drift guard before
  any app folds; expect merge conflicts in `_generated/` to be resolved by rerunning
  `apps:gen`.
- Cancelled CI runs strand image digests (see memory): after each Track 0 infra slice,
  verify pod image age; recover with `force_all` dispatch.
- Portal DB teardown is the one destructive step: gated on live row-count verification +
  NAS dump (decision 7).

## Backlog (user-queued, not yet planned)

- **scripts/ cleanup** (Calum, 2026-07-21): the scripts folder is a mess. Track 0 already
  deletes the 6 product-plurality check scripts (Task 9) + portal export/import (Task 6);
  after Track 0 lands, audit the survivors — inventory, delete dead ones, group the rest
  (quality-gate vs ops vs codegen), decide what graduates into `apps:gen`/package scripts.

## Ticket-later (from Track 0 final review, 2026-07-21)

- Wire `web/e2e-portal` playwright suite into CI (promised since Task 2.6, still manual-only).
- `scripts/check-dockerfile-manifests.ts`: validate COPY sources exist (gap that broke main ~2h in Task 5).
- Task 7 Step C additions: `scripts/verify-wall-panel.mjs` default still app--cc; orphaned app--cp machinery (certmanager.ts:16, infra/unifi applyAppCp, platform "cp" dnsCode).
- Platform prune residue: ~20 zero-consumer exports (DnsCode, defineTarget, secretCatalog.captivePortal, ProductIdentity.folder claims products/<slug>), InfraNamespaceName casts in cnpg/crons/secrets-map.
- `CAPTIVE_PORTAL_POSTGRES__PASSWORD` in secrets/vault.yaml — prune + rotate.
- Guest listener nits: URIError on malformed URI → Bun 500 (no leak); explicit httpPort 443/80 has no executing coverage; smoke redaction assertion conditional.
- Housekeeping: save-resend.sh orphaned, rename-identity-allowlist dead patterns, unused portal icons @public tags, render.test.ts fixture names, .DS_Store cruft.
- A11y: WifiPassword double accessible-name. UX: password lost across Terms round-trip (pre-existing).
