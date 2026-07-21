# Track 0: Product Merge + Platform Prune + Repo Flatten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Parent roadmap (all decisions + later tracks): `2026-07-21-consolidation-roadmap.md`.

**Goal:** Dissolve the captive-portal product into control-center (one product, one Postgres,
one image family, portal-only guest listener), prune the multi-product platform machinery, and
flatten `products/control-center/*` to the repo root.

**Architecture:** The portal backend already lives in control-center (`portal` router/service/
repo/tables/cron); the captive-portal product is a thin deployment wrapper. This track deletes
the wrapper while preserving the one load-bearing boundary — guests must only ever reach a
portal-only tRPC surface — as a *listener* inside the control-center API image instead of a
separate product. Then it removes everything whose only reason was product plurality.

**Tech Stack:** Bun, tRPC, Vite, Pulumi (k8s + Cloudflare), CNPG Postgres, GitHub Actions.

## Global Constraints

- Every task ends green: `bun run typecheck` + the tests named in the task, then commit +
  push to `main` (deploys prod). Never batch tasks into one push.
- Stage explicit paths only — never `git add -A` (parallel sessions share this checkout).
- Guests must NEVER be able to reach non-portal routers: at no intermediate commit may the
  LAN-facing surface serve the full `appRouter` (ADR-0004: PIN is client-side only).
- The control-center Postgres (`control_center` db, `control-center-1` pod) is untouchable in
  Task 6 — only the `captive-portal` cluster is torn down, after verification + NAS dump.
- After each infra task, verify pod image age (cancelled-CI stranded-digest risk); recover
  with a `force_all` dispatch if stale.
- IDs stay `prefix_<id>`; backend logging via `@www/logger`; no fake/placeholder data.

---

### Task 1: Record the decisions — ADR-0006, CONTEXT.md, ADR-0005 fix

**Files:**
- Create: `docs/adr/0006-single-product-captive-portal-becomes-app.md`
- Modify: `CONTEXT.md` (Product + App entries; add PIN Session semantics)
- Modify: `docs/adr/0005-shared-substrate-pulled-down-to-packages-core.md` (stale `device_commands` reference)

**Interfaces:**
- Produces: ADR-0006, cited by every later task that deletes product machinery.

- [ ] **Step 1: Write ADR-0006** with this content (adjust prose freely, keep every decision):
  - Title: "There is one product; captive-portal becomes the guest-wifi App"
  - Decision: captive-portal product dissolves into control-center. Guest surface = portal-only
    listener in the control-center API image (separate port; mounts only the portal router +
    guest static bundle). Guest web = second vite entrypoint on shared cc ui primitives.
    Single Postgres (`control_center`); the captive-portal cluster + migration tooling delete
    (the ADR must note the split's cutover was never approved — cc stayed source of truth).
    Hostnames: `app.worldwidewebb.co`; the `${host}--${dnsCode}` flattening and dnsCode
    concept delete; `dashboard.worldwidewebb.co` retires. Repo flattens: `products/` dies,
    future products get their own repos.
  - Why recorded: hard to reverse (deletes a product, a database cluster, DNS names, and the
    products/ path layer); surprising without context (reader finds NORTH_STAR multi-product
    docs and one product); real trade-off (in-repo product plurality vs. per-repo products —
    decided by one-adapter/one-inhabitant evidence: every plurality mechanism had exactly one
    real user).
  - Supersedes: the multi-product framing of `docs/platform/README.html` + `NORTH_STAR.html`
    (mark those docs superseded by a banner note or delete them in Task 8).
- [ ] **Step 2: Update CONTEXT.md**: Product entry — no longer "control-center,
  captive-portal"; one Product, term retained only for the deploy unit. App entry — add
  guest-wifi as the canonical example. Add to Security section: "PIN Session (decided
  2026-07-21): one shared session covers all Sensitive surfaces; expires on idle-reset;
  explicit close supported; client-only until Slice S."
- [ ] **Step 3: Fix ADR-0005** — remove/annotate the `device_commands` reference (table no
  longer exists; only a historical comment at `light-enforcer-service.ts:121` remains).
- [ ] **Step 4: Commit + push** — `git add docs/adr/ CONTEXT.md && git commit -m "docs(adr): ADR-0006 single product; fix ADR-0005 stale table ref"`

### Task 2: Guest bundle — portal screens on cc ui primitives

**Files:**
- Create: `products/control-center/web/portal.html` (second vite entrypoint)
- Create: `products/control-center/web/src/portal/` (screens + entry)
- Modify: `products/control-center/web/vite.config.ts` (multi-entry build)
- Test: port `products/captive-portal/apps/frontend/e2e/*.spec.ts` (playwright) + screen tests

**Interfaces:**
- Consumes: `src/components/ui/*` primitives, theme tokens, `@cc/api` portal router types.
- Produces: `dist/portal/` static bundle, served by Task 3's listener at `/`.

This task is code-heavy (9 screens: WifiPassword, Terms, Connecting, Success,
AlreadyConnected, SessionExpired, RateLimited, GenericError + landing; 7 portal primitives
map onto cc ui equivalents). **Author its detailed sub-plan at execution time** (fresh read of
`products/captive-portal/apps/frontend/src/` + cc `ui/` inventory), same file conventions as
this plan: `2026-07-XX-track-0-guest-bundle.md`. Requirements the sub-plan must satisfy:

- [ ] Storybook-first for any new/adapted ui primitive; responsive mobile layout (guest
  phones), unlike the fixed-1366×1024 board.
- [ ] Bundle must stay small: no board imports, no MapLibre, no tile code. Enforce with a
  test asserting the portal entry's module graph excludes `src/components/Board` and
  `src/lib/tile-registry` (mirror the pattern of `cc-coupling-boundary.test.ts`).
- [ ] All portal e2e specs (smoke, terms, a11y-landing, landing-validation, flow-matrix,
  refresh-persistence) pass against the new bundle before Task 4 cuts traffic over.
- [ ] Commit + push per slice within the sub-plan.

### Task 3: Portal-only guest listener in the control-center API

**Files:**
- Create: `products/control-center/api/src/guest-server.ts`
- Modify: `products/control-center/api/src/server.ts` (start guest listener when configured)
- Modify: `products/control-center/api/src/env.ts` (add `GUEST_PORT`, `GUEST_TLS_DIR`, `GUEST_STATIC_DIR` — all optional; listener off when unset)
- Test: `products/control-center/api/src/__tests__/guest-server.test.ts`

**Interfaces:**
- Consumes: `portalRouter` (`trpc/routers/portal.ts`), `createContext` (`trpc/context.ts`).
- Produces: HTTP surface on `GUEST_PORT`: `/up`, `/trpc/portal.*` (portal router ONLY, mounted as `router({ portal: portalRouter })` to keep guest client paths unchanged), static files from `GUEST_STATIC_DIR` with SPA fallback to `index.html`. TLS via `Bun.serve` `tls:` reading `fullchain.pem`/`key.pem` from `GUEST_TLS_DIR` when set (cert-manager secret projected with those names — same projection the nginx portal used). Plain HTTP on `GUEST_PORT+1` for captive-portal detection probes.

- [ ] **Step 1: Write failing tests** — guest listener: (a) `/trpc/portal.state` (or the
  real first portal procedure name — read `portal.ts`) responds; (b) a non-portal path
  `/trpc/health.ping` returns 404 — **the security property, this test is the point of the
  task**; (c) `/` serves `index.html`; (d) unset `GUEST_PORT` → no listener.
- [ ] **Step 2: Run tests, verify fail** — `cd products/control-center/api && bunx vitest run src/__tests__/guest-server.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `guest-server.ts`** — port the existing
  `products/captive-portal/apps/api/src/server.ts` structure (CORS headers, `/up`, request
  logging with `reqId`, `fetchRequestHandler`) into a `startGuestServer(opts)` export; router
  is `router({ portal: portalRouter })` built via `trpc/init.ts`'s `router`; add static
  serving + TLS as per Produces block. Wire into `server.ts` after migrations:
  `if (env.GUEST_PORT) startGuestServer({...})`.
- [ ] **Step 4: Tests green, typecheck green** — same vitest command → PASS; `bun run typecheck`.
- [ ] **Step 5: Commit + push** — `feat(cc/api): portal-only guest listener (ADR-0006)`.

### Task 4: Infra cutover — guest traffic to the listener, portal workloads deleted

**Files:**
- Modify: `infra/src/services.ts` (delete `captive-portal-portal` + `captive-portal-api` workloads; add guest listener env/ports/TLS-secret projection to the `control-center-api` workload; move the LAN LoadBalancer 443/80 exposure onto it)
- Modify: `infra/src/eso.ts`, `infra/src/secrets-map.ts` (portal secret usages fold into the api's set: `UNIFI_API_KEY`, `WIFI_PASSWORD`, `WIFI_SSID` — `POSTGRES_PASSWORD` already there)
- Modify: `infra/src/cluster.ts` / namespace decl (captive-portal namespace removal)
- Test: `infra` unit tests (`bun run --filter infra test`), then live verification

**Interfaces:**
- Consumes: Task 3's `GUEST_PORT`/`GUEST_TLS_DIR`/`GUEST_STATIC_DIR` contract; Task 2's bundle baked into the api image (Dockerfile gains a portal-dist COPY — adjust `scripts/check-dockerfile-manifests.ts` expectations).

- [ ] **Step 1: Sequence safely** — first deploy the api with the listener live but UNIFI
  walled-garden/DNS still pointing at the old portal (both up in parallel); verify with
  `curl -k https://<lan-ip>:443/up` against the new surface from LAN context.
- [ ] **Step 2: Cut over** — move the LAN LoadBalancer/`expose: "lan"` ports + the
  `captive-portal-tls` secret projection (`tls.crt→fullchain.pem`, `tls.key→key.pem`) to the
  api workload; run the portal e2e smoke spec against the live LAN endpoint (real guest flow:
  join guest WiFi, land, auth).
- [ ] **Step 3: Delete** the two captive-portal workloads, their namespace, digest keys, and
  `mountSecrets("captive-portal-api")` wiring. `pulumi up` via push; confirm
  `kubectl --context cc-homelab get ns captive-portal` → NotFound.
- [ ] **Step 4: Commit + push per step above** (this task is 2–3 pushes, each green).

### Task 5: Delete the captive-portal product from repo + CI

**Files:**
- Delete: `products/captive-portal/` (whole tree), `products/captive-portal/Dockerfile.api`
- Modify: `.github/workflows/ci.yml` (drop `build-captive-portal` + `build-captive-portal-api` jobs at :387-421, their `needs:` entries at :451/:648, digest-map entries at :542, and `products/captive-portal/**` path filters at :105-142)
- Modify: `package.json` (workspaces globs lose nothing yet — `products/*` still matches control-center; scripts: delete `test:product-ci-isolation` etc. ONLY if they hard-reference captive-portal; otherwise leave for Task 9)
- Modify: `knip.jsonc`, `lefthook.yml` if they reference portal paths

**Interfaces:**
- Consumes: Task 4 complete (nothing deploys from these paths anymore).

- [ ] **Step 1: Grep first** — `grep -rn "captive-portal" --include="*.{ts,tsx,yml,jsonc,json}" . | grep -v node_modules | grep -v docs/` and disposition every hit (delete, or defer-to-Task-8/9 with a note in the commit message).
- [ ] **Step 2: Delete + fix** — `git rm -r products/captive-portal`; CI edits; run `bun run typecheck && bun run knip && bun run test:dockerfile-manifests`.
- [ ] **Step 3: Commit + push** — `feat!: remove captive-portal product (ADR-0006)`; watch CI green + deploy.

### Task 6: Portal Postgres teardown (DESTRUCTIVE — gated)

**Files:**
- Modify: `infra/src/cnpg.ts` (remove the captive-portal cluster branch at :62-63, :87-88 and its cluster decl), related auth secrets in `infra/src/eso.ts`
- Delete: `products/…/migration/portal-migration.ts` + test (if not already gone with Task 5), `scripts/portal-export.sh`, `scripts/portal-import.sh`
- Modify: `packages/platform/src/index.ts` (captive-portal `database`/`backup` entries)

- [ ] **Step 1: Verify (REQUIRED before any deletion)** — row counts both sides:
  `kubectl --context cc-homelab -n control-center exec control-center-1 -c postgres -- psql -U postgres -d control_center -c "select 'portal_guest', count(*) from portal_guest union all select 'portal_code', count(*) from portal_code union all select 'portal_attempt', count(*) from portal_attempt union all select 'portal_authorization', count(*) from portal_authorization"`
  and the equivalent against the captive-portal cluster pod. Expected: cc ≥ portal cluster on
  every table (cutover never approved). **If the portal cluster has rows cc lacks, STOP and
  surface to Calum.**
- [ ] **Step 2: Safety dump** — `pg_dump -Fc` of the portal cluster to the NAS backup path
  (mirror `infra/src/crons.ts` pg-backup target), named `captive-portal-final-YYYYMMDD.dump`.
- [ ] **Step 3: Delete** cluster + secrets + tooling; push; confirm cluster gone and
  control-center Postgres untouched (`select count(*) from portal_authorization` unchanged).
- [ ] **Step 4: Commit message records the dump location.**

### Task 7: Hostname cutover — `app.worldwidewebb.co`

**Files:**
- Modify: `infra/cloudflare/src/routes.ts`, `infra/cloudflare/src/access.ts` (new `app` hostname; retire `app--cc` plan + `dashboard` legacy)
- Modify: `packages/platform/src/index.ts` (`:190-193` flattening helper + dnsCode; `:647` legacyHostname)

- [ ] **Step 1: Add `app.worldwidewebb.co`** routing to the panel web origin alongside the
  existing names; deploy; verify panel loads on the new name (Universal SSL one-label —
  covered).
- [ ] **Step 2: Repoint the physical panel** (Capacitor shell / saved URL) — coordinate with
  Calum if it needs an on-device change; frontend_log `device_id` confirms the panel is on
  the new origin.
- [ ] **Step 3: Retire** `dashboard.worldwidewebb.co` + the unfinished `app--cc` cutover
  machinery; delete the `${host}--${dnsCode}` helper + `dnsCode` from platform; typecheck
  ripples through `infra/cloudflare` consumers.
- [ ] **Step 4: One push per step; verify panel + Access policies after each.**

### Task 8: Platform prune (C3, deepened by the merge)

**Files:**
- Modify: `packages/platform/src/index.ts` — delete: `targetStatus`/`"cloud"` arm/`UnsupportedTargetName` (:62-138), `TargetCapabilities` (:68-75), `TlsCoverage` (:145-151), `humanReview` (:177-181), `commandFeatures` (:573-578, keep `dateFormat` where crons reads it), `services[].image`/`workloadName` (:705-752), captive-portal manifest entirely; merge `apiSecrets`/`workerSecrets` lockstep blocks (:396-449) into one base set + per-service delta
- Modify: `packages/platform` tests (drop dead-arm suites; keep exposure/database/backup/secretUsages coverage)
- Modify: `scripts/check-control-center-product-boundary.ts` (shrinks to surviving facets)
- Modify/Delete: `docs/platform/README.html`, `docs/platform/NORTH_STAR.html` (superseded banner or delete, per ADR-0006)

- [ ] **Step 1: Consumer check before each deletion** — for each symbol:
  `grep -rn "<symbol>" --include="*.ts" infra products packages scripts | grep -v packages/platform` → must be empty (findings said 0; re-verify at execution).
- [ ] **Step 2: Delete + collapse; update tests; `bun run typecheck && bun run --filter @www/platform test`** (check the actual filter name in `packages/platform/package.json`).
- [ ] **Step 3: Commit + push** — `refactor(platform)!: prune zero-consumer plurality machinery (ADR-0006)`.

### Task 9: Repo flatten — `products/control-center/*` → root

**Files:**
- Move: `products/control-center/{web,api,worker,ios,storybook,drizzle,map-provision,tilt,Tiltfile,docker-compose.yml,product.json,README.md}` → repo root (`web/`, `api/`, `worker/`, `ios/`, …); `git mv` to preserve history
- Modify: `package.json` workspaces → `["web", "api", "worker", "packages/*", "infra", "infra/unifi", "infra/cloudflare"]` (plus whatever of storybook/map-provision are workspaces — check `scripts/check-product-workspaces.ts` first); root scripts lose `products/control-center` paths
- Modify: every Dockerfile COPY path, `.github/workflows/ci.yml` path filters (product-awareness collapses: `web/**`→web image, `api/**`+`packages/**`→api+worker, etc.), Tiltfile, `tsconfig.json` refs, `biome.json`/`knip.jsonc`/`lefthook.yml` path globs, `vitest.config.ts`
- Delete: product-plurality check scripts (`check-product-workspaces`, `check-control-center-ci-split`, `check-product-ci-isolation`, `check-tilt-product-lanes`, `check-product-doc-paths`, `check-control-center-product-boundary` — fold any still-load-bearing assertion into a simpler root-layout check), their `package.json` script entries
- Modify: `CLAUDE.md` / `AGENTS.md` / `CODEBASE_OVERVIEW.md` paths (registry invariant path, tile-registry path, debugging paths)

**Interfaces:**
- Consumes: Tasks 5+8 done (no captive-portal, no product-boundary checker in old shape).
- Produces: the root layout every later track's plan assumes (`web/src/…`, `api/src/…`).

- [ ] **Step 1: Announce** — this slice conflicts with every parallel session's open edits;
  coordinate a quiet window with Calum before starting (8–10 concurrent sessions share this
  checkout).
- [ ] **Step 2: `git mv` in one commit** — moves only, zero content edits, so history follows.
- [ ] **Step 3: Path-fix commit(s)** — workspaces, Dockerfiles, CI, Tiltfile, configs, docs;
  package NAMES (`@control-center/api`, `@cc/api`, `@product/control-center`) stay unchanged
  this track (rename is cosmetic churn; revisit post-Track-C).
- [ ] **Step 4: Full gate** — `bun install && bun run typecheck && bun run test && bun run knip && bun run gate`; CI green on push; verify all deployed images rebuilt from new paths and pods run fresh digests.
- [ ] **Step 5: Update CODEBASE_OVERVIEW.md** workspace-layout section; commit + push.

---

## Self-review notes

- Coverage: decisions 3–9 of the roadmap all have a task (1=docs, 2=guest web, 3=listener,
  4=infra cutover, 5=repo delete, 6=DB, 7=hostnames, 8=prune, 9=flatten). Decisions 10–16
  are Tracks A–C, out of scope here by design.
- Line numbers cited (services.ts:318-360, platform index.ts:62-752, ci.yml:105-648) were
  verified 2026-07-21; re-grep before editing — parallel sessions move code daily.
- Task 2 delegates to a sub-plan on purpose: 9 screens of UI porting can't be truthfully
  pre-written here; the sub-plan requirement block is binding.
