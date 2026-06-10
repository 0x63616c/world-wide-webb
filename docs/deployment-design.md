# Control-Center Deployment Design

Status: **DRAFT for review** · Scope: build a generic config-driven deploy tool (`bosun`) and deploy control-center to the Mac Mini (`homelab`) through it.

> **For the implementing agent:** read this whole doc, then follow **Part 14, Implementation order**. The companion [`acceptance-checklist.md`](./acceptance-checklist.md) is the definition of done. Everything here runs as the normal user (no sudo).

---

## Part 1: Plain English (read this first)

We're building two things at once:

1. **`bosun`**, a small, reusable deploy tool. You describe a project's services in a typed TypeScript file (`deploy.config.ts`), and `bosun` deploys them to a Docker Swarm: it pushes the right secrets in (from 1Password), wires up the public routes (Cloudflare), starts the containers, and then *proves they actually work* by running health checks you declared. It also **cleans up**, secrets and routes that you stop declaring get removed automatically.

2. **control-center**, the dashboard, as the first project deployed *through* `bosun`.

The Mini runs **OrbStack** (Docker) with **Swarm** turned on (keeps containers running, restores them after reboot). **Portainer** runs purely as a **monitoring UI** (CPU/memory per service). It does **not** deploy anything, `bosun` is the only thing that deploys.

The clever part is the config is *real code* but **pure**: `deploy.config.ts` is a TypeScript program that builds a static description and nothing else (no network, no side effects). It declares secret *references* (e.g. "api needs the HA token from 1Password"), never the secret values. So it can run anywhere, in CI, locally, on the box, and always produces the same description with no secrets in it. The actual secret *values* are read once, at deploy time, by whichever machine has the credentials, and pushed straight into Docker's encrypted secret store.

When you push code: **GitHub Actions builds the images** (off the Mini), pushes them to GitHub's registry, then pings the Mini to run `bosun up`. Config-only changes deploy in seconds; code changes take a build.

**Cloudflare** is untouched, the tunnel and all `*.worldwidewebb.co` routing still live in your account; `bosun` just reconciles the routes and runs the connector. HTTPS is automatic at Cloudflare's edge.

**Three things stay on the host by hand:** Tailscale, the Home Assistant VM, and OrbStack. Everything else is declared in git and deployed by `bosun`.

---

## Part 2: Goals & Non-Goals

**Goals**
1. Build `bosun`: a generic, config-driven Swarm deploy tool (typed TS manifest, pure eval, secret + route + service + health reconcile with prune).
2. Deploy control-center through it (web, api, postgres, cloudflared, storybook), with Portainer as monitoring.
3. Minimal host deps (OrbStack + Tailscale + HA VM).
4. Declarative & reproducible: the running system matches `deploy.config.ts`.
5. Fast: push → deployed in seconds for config, build-bound for code.
6. Survives reboots with no manual step.
7. Keep `*.worldwidewebb.co` working, zero Cloudflare-side reconfiguration.
8. Secrets sourced from 1Password (pluggable), never in git/CI/images.

**Non-Goals**
1. The broader `evee` platform. Control-center only.
2. Multi-node / HA redundancy.
3. Migrating Home Assistant off the host VM.
4. Public auth (Cloudflare Access) on the dashboard.
5. Gold-plating `bosun` beyond what control-center needs (build the MVP that deploys this repo; keep it tool-shaped but don't add unused backends).

---

## Part 3: The two deliverables

| Deliverable | Where | What |
|---|---|---|
| **`bosun`** (the tool) | `packages/bosun/` | Generic Swarm deploy CLI + typed config API + providers + reconcilers + health |
| **control-center deploy** | `deploy.config.ts`, `apps/*/Dockerfile`, `.github/workflows/`, `scripts/` | The dashboard described and deployed through `bosun` |

The agent builds **both**, and proves both via the checklist.

---

## Part 4: Architecture layers

```
┌─ HOST INFRA (manual, rarely changes) ───────────────────────────┐
│  Tailscale (system daemon)   · Home Assistant (QEMU VM @ :8123)  │
├─ RUNTIME (one dep) ─────────────────────────────────────────────┤
│  OrbStack (start-at-login)   → Docker engine + single-node Swarm │
├─ SWARM ─────────────────────────────────────────────────────────┤
│  portainer        → MONITORING ONLY (no deploys)                 │
│  bosun-agent   → runs `bosun up` on trigger (deploy plane) │
│  ── app stack (deployed by bosun) ──                          │
│  web · api · postgres · cloudflared · storybook                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 5: The deploy tool: `bosun`

### 5.1 What it is
A bun/TypeScript CLI at `packages/bosun/`. Invoked from repo root as `bun run bosun <cmd>` (add a root `package.json` script `"bosun": "bun packages/bosun/src/cli.ts"`). Suggested layout:

```
packages/bosun/
  src/
    cli.ts              # command dispatch: plan | secrets | routes | up | verify | serve
    spec.ts             # typed builder API exported FOR configs to import
    config.ts           # load + evaluate a deploy.config.ts → static Spec
    providers/          # SecretProvider implementations
      op.ts  file.ts  env.ts
    reconcile/
      secrets.ts        # create declared + prune orphaned (label-scoped)
      routes.ts         # Cloudflare tunnel routes: create + prune (tag-scoped)
      stack.ts          # render Spec → stack.yml, docker stack deploy --prune
    health.ts           # run declared probes → exit code + per-probe report
  test/                 # unit tests (vitest)
```

### 5.2 The manifest: `deploy.config.ts` (typed, pure)
A TypeScript file at repo root that imports the builder API and `export default`s a stack. Example shape:

```ts
import { stack, service, postgres, fromOp, ghcr, httpProbe, cmdProbe } from "@bosun/spec"

export default stack("control-center", {
  services: [
    service("api", {
      image: ghcr("control-center-api"),                 // ghcr.io/0x63616c/control-center-api:main
      secrets: fromOp("Homelab", {                        // declares REFERENCES, not values
        HA_TOKEN: "Home Assistant Token/credential",
        UNIFI_API_KEY: "UniFi/local_api_key",
      }),
      env: { HA_URL: "http://host.docker.internal:8123" },
      health: [httpProbe("http://api:4201/up", 200),
               cmdProbe("live HA data", "curl -s http://api:4201/api/climate.now | jq -e .tempC")],
    }),
    service("web", {
      image: ghcr("control-center-web"),
      route: "dashboard.worldwidewebb.co",                // single-level → free CF HTTPS
      proxyApiTo: "api:4201",                             // web reverse-proxies /api → api
      health: [httpProbe("https://dashboard.worldwidewebb.co", 200, { certValid: true })],
    }),
    service("storybook", { image: ghcr("control-center-storybook"), route: "storybook.worldwidewebb.co" }),
    postgres({ volume: "pgdata", config: ["infra/postgres/postgresql.conf"], init: ["infra/postgres/initdb"] }),
    service("cloudflared", { image: "cloudflare/cloudflared:2025.10.1",
      secrets: fromOp("Homelab", { TUNNEL_TOKEN: "Cloudflare Tunnel evee-webhooks/connector_token" }),
      command: "tunnel --no-autoupdate run --token $TUNNEL_TOKEN" }),
  ],
})
```

### 5.3 Purity rule (non-negotiable)
`deploy.config.ts` **evaluates to static data and performs no I/O**, no network, no `op` calls, no reading ambient state, no nondeterminism. It declares secret/route *references*; resolution happens later in the tool. `bosun plan` must produce **byte-identical** output on repeated runs and contain **zero secret values**. Optionally snapshot the resolved static spec to `deploy.lock.json` for a diffable record.

### 5.4 Commands
| Command | Does | Touches secret *values*? |
|---|---|---|
| `bosun plan` | evaluate config → print the static Spec (refs, not values) | ❌ pure |
| `bosun secrets sync` | resolve refs via provider → create declared docker secrets, **prune** orphaned (scoped) | ✅ |
| `bosun routes sync` | reconcile Cloudflare tunnel routes from `route:` decls, **prune** orphaned (scoped) | uses CF API token |
| `bosun up` | `plan` → `secrets sync` → `routes sync` → render + `docker stack deploy --prune` → `verify` | ✅ |
| `bosun verify` | run every declared health probe; exit 0 iff all pass; print per-probe report | ❌ |
| `bosun serve` | webhook receiver: runs `up` on an authenticated POST (HMAC/bearer) | ✅ |

### 5.5 Reconcile semantics (with safe prune)
- **Secrets:** docker secrets are immutable. The tool names each `cc_<name>_<shorthash-of-value>` and labels them `bosun.stack=control-center`. Sync: create any missing hashed secret, render the stack to reference the *current* hashed names, then **prune** only secrets carrying the stack label that are no longer referenced. Changed value → new hash → new secret → service rolls → old pruned. **Prune is label-scoped** so it can never delete another stack's or Portainer's secrets.
- **Routes:** create Cloudflare public-hostname routes for declared `route:` values (via CF API, token from 1Password) pointing at `service:port`; **prune** only routes tagged/owned by this stack. Routes stay remote-managed; unmanaged hostnames are never touched.
- **Services:** render Spec → `stack.yml` → `docker stack deploy --prune control-center` (Swarm adds/updates/removes services to match).
- **Health:** see 5.7.

### 5.6 Secrets: the three-plane model + providers
- **Build plane (CI):** builds images. No app secrets.
- **Config plane (anywhere):** evaluates the config. Pure, refs only, no values.
- **Sync plane (one privileged place):** resolves refs → values → docker secrets. Runs where creds + swarm coexist: **locally** (your `op` session + tailnet) or **on the box** (`bosun-agent` with a 1Password service-account token). **Never** a cloud CI runner (can't reach the tailnet-only Mini, has no 1Password).
- **`SecretProvider` interface:** `op` (default), `file` (local), `env`. A declared ref like `op://Homelab/Home Assistant Token/credential` resolves through whichever provider the environment configures, "somewhere can be local."

### 5.7 Health probes
Each service declares probes; `bosun verify` runs them and is the gate. Probe kinds:
- `httpProbe(url, expectStatus, { certValid? })`, HTTP status (and optional cert validity).
- `cmdProbe(desc, shellCmd)`, command exits 0.

`bosun up` runs `verify` after deploy; on failure it reports per-probe and (optional) auto-rolls the failed service back to its previous image. Many checklist items are satisfied by declared probes that `verify` runs.

---

## Part 6: Control-center's manifest

`deploy.config.ts` declares: **web** (static + `/api` reverse-proxy, route `dashboard.worldwidewebb.co`), **api** (bun tRPC `:4201`, HA via `host.docker.internal:8123`, internal-only), **postgres** (pinned, `pgdata` volume, `postgresql.conf` via docker config, initdb), **cloudflared** (pinned, connector token), **storybook** (route `storybook.worldwidewebb.co`). Secret references come from the existing **`tilt/op-secrets.tpl`** (HA_TOKEN, UNIFI_API_KEY, WIFI_SSID, WIFI_PASSWORD) plus the Cloudflare connector token from the `evee` repo. New secrets (Postgres password, Portainer admin, GHCR pull token, op service-account token) get an interactive `scripts/save-<thing>.sh` per the 1Password convention.

---

## Part 7: Images & CI

- **Dockerfiles:** multi-stage bun builds for `apps/web`, `apps/api`, `apps/web` storybook. `web` serves the static build **and** reverse-proxies `/api` → `api`. `api` entrypoint runs `bun run --cwd apps/api db:migrate` then starts the server (migrate-on-boot; Swarm crash-backoff handles ordering since it ignores `depends_on`).
- **CI (`.github/workflows/`):** on push, **path-filtered per-app** builds (`dorny/paths-filter`) → only changed apps rebuild → push `ghcr.io/0x63616c/control-center-{web,api,storybook}:<sha>` and `:main`, with buildx layer cache. Shared changes (`packages/**`, root lockfile) rebuild all. After pushing, CI calls the deploy webhook (Part 12).
- **Deploy marker + drift watchdog (www-bom8):** on `main` the path filter diffs against **`refs/deploy/main`** (the last commit whose run left prod current), NOT the push range. `cancel-in-progress: true` means a run inherits the build work of every run it cancelled; a push-range diff can't see that work (four web commits were once stranded undeployed by a surviving docs-only push). The `mark-deployed` job force-pushes the marker forward only after a fully-green run (deploy succeeded, or green with nothing to ship); failed/cancelled runs leave it behind, so the drift stays visible to the next run. `workflow_dispatch` takes `force_all` (default `true` = rebuild/redeploy everything; `false` = selective vs the marker). Backstop: `deploy-drift.yml` (cron, 30 min) dispatches a selective run when the marker is behind `main` and no CI run is in flight, so prod converges instead of stalling. Bootstrap/recovery: if the marker is ever missing or wrong, one manual full dispatch (`gh workflow run ci.yml --ref main`) rebuilds, redeploys, and re-seeds it.
- **Swarm can't build images** (`docker stack deploy` ignores `build:`), so a registry is mandatory → CI→GHCR is required, not optional. Keeps build load off the 8 GB box.

---

## Part 8: Networking & Cloudflare

1. Tunnel `evee-webhooks` (remote-managed); routes reconciled by `bosun routes sync`, never hand-edited.
2. Outbound-only; **no inbound ports** on the Mini.
3. HTTPS at Cloudflare's edge via free Universal SSL → **single-level hostnames only** (`*.worldwidewebb.co`). All public names single-level: `dashboard.`, `storybook.`, `portainer.`, `hooks.`.
4. Routes target swarm `service:port`. Deploy webhook is a path under `hooks.worldwidewebb.co` → `bosun-agent`.

---

## Part 8b: Cloudflare Access (edge auth gate, www-cuuw)

Every `*.worldwidewebb.co` host is served through the one tunnel and is reachable by anyone with the URL; the dashboard's tRPC api is unauthenticated, so the URL controls the house. We lock this at the **Cloudflare edge** with **Cloudflare Access** (free Zero Trust tier), managed **declaratively in bosun**, it reconciles on every `bosun up` exactly like routes/DNS.

**Invariant: default-deny.** A wildcard Access app `*.worldwidewebb.co` with action **Block** is the floor; any subdomain not covered by a more specific allow app is denied at the edge (including brand-new/accidental subdomains). Explicit per-host allow apps sit above it (CF matches the most-specific app).

### Access matrix

| Host | Policy | Credential | Builder |
|---|---|---|---|
| `*.worldwidewebb.co` (floor) | Block | none (deny all) | `accessFloor()` (stack-level) |
| `dashboard.worldwidewebb.co` | service_auth | **kiosk** service token (iPad) | `accessServiceToken({tokenName:"bosun-kiosk", clientIdEnv:"CF_ACCESS_KIOSK_CLIENT_ID"})` |
| `storybook.worldwidewebb.co` | allow | email OTP (Calum's login email, in 1Password) | `accessEmail(...)` |
| `drizzle.worldwidewebb.co` | allow | email OTP | `accessEmail(...)` |
| `hooks.worldwidewebb.co` | service_auth | **CI** service token (GitHub Actions) | `accessServiceToken({tokenName:"bosun-ci", clientIdEnv:"CF_ACCESS_CI_CLIENT_ID"})` |

`hooks` keeps its existing app-level `BOSUN_WEBHOOK_TOKEN` as a second, independent gate.

### How the machinery works

- **Spec:** `access?: AccessSpec` on a service (domain = its `route`); `accessFloor?: AccessSpec` at the `stack()` level. Builders `accessEmail` / `accessServiceToken` / `accessFloor` (`packages/bosun/src/spec.ts`).
- **Reconcile:** `reconcileAccess` (`packages/bosun/src/reconcile/access.ts`), lists apps, creates/updates declared apps tagged `bosun:<stack>`, prunes ONLY tag-owned orphans (never a foreign app), and READS service tokens to resolve a token NAME → CF id. It NEVER creates or deletes service tokens.
- **CLI:** an Access step in `reconcileCloudflare()` (advisory-guarded, after routes/DNS) plus `bosun access sync`. **Empty-set short-circuit:** with no `access:`/`accessFloor` declared it makes ZERO CF Access API calls, so no Access token scope is needed until cutover.
- **Kiosk:** the iPad sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. Capacitor 8 has **no `server.headers`** (verified against the SDK), so headers are injected natively: `KioskViewController` re-issues the initial origin load with headers; `KioskWatchdog` carries them on its probe + reload and recognizes the CF Access login interstitial as a distinct recovery state (never loops on the login wall). Creds bake into Info.plist from repo secrets via `Fastfile` xcargs (`ios-build.yml`).

### Service tokens & 1Password

Two service tokens, created ONCE by a human:

```bash
scripts/save-cf-access-tokens.sh   # creates bosun-kiosk + bosun-ci, writes id+secret to 1Password
```

It POSTs the two CF service tokens, captures each one-time `client_secret`, and writes `client_id` + `client_secret` into 1Password items **`CF Access Kiosk Token`** and **`CF Access CI Token`** (Homelab). Idempotent: an existing item is skipped. Client **secrets** are secret; client **ids** are not (they ride the docker-secret channel only to stay out of this public repo). `reconcileAccess` only references the tokens; the save-script is the only thing that ever sees a secret.

### Prerequisites (human, blocking)

1. **Zero Trust enabled** on the CF account (one-time free dashboard step: set a team name / `*.cloudflareaccess.com` org domain). Required for ANY Access app to exist.
2. **CF API token scopes.** The deploy-time token (`op://Homelab/Cloudflare API/credential`) needs **Access: Apps and Policies, Edit** + **Access: Service Tokens, Read** (the name→id lookup; it never mutates tokens). The save-script needs **Access: Service Tokens, Edit** (to POST the two tokens), grant it on the same token or use a short-lived one. Without these, the first live Access reconcile 403s.

### Rollout order (the floor goes live LAST)

The machinery is **inert** until declarations exist in `deploy.config.ts` AND the `CF_ACCESS_*_CLIENT_ID` fromOp lines are added to the bosun-agent secrets block. The deferred-fromOp note is in `deploy.config.ts`, those refs MUST wait until the 1Password items exist, or `secrets sync` throws on a missing op item and aborts every deploy.

0. Confirm prerequisites above.
1. Ship machinery (done, units 1-7). Deploys are unchanged (empty-set short-circuit).
2. Run `scripts/save-cf-access-tokens.sh`. Verify CF most-specific-app precedence on a scratch host before any wildcard-Block covers a live host.
3. Add `accessEmail(...)` to `storybook` + `drizzle`; deploy. Low risk (human-only; worst case an OTP login).
4. Wire the CI caller: add `-H CF-Access-Client-Id` / `-H CF-Access-Client-Secret` to the deploy `curl` in `ci.yml` (repo secrets from `CF Access CI Token`), pure per-request header auth, NO cookie. Confirm a deploy still succeeds, THEN add `accessServiceToken(...)` to `bosun-agent`. The existing `BOSUN_WEBHOOK_TOKEN` is belt-and-suspenders.
5. **OUT-OF-SESSION:** ship the kiosk TestFlight build (kiosk repo secrets `CF_ACCESS_KIOSK_CLIENT_ID/SECRET`), install on the iPad, confirm it loads the still-open dashboard. This is the gate for step 6.
6. **Cutover (LAST, gated on step 5):** add `accessServiceToken(...)` to `web` + `accessFloor: accessFloor()` to the `stack()` opts AND the two `CF_ACCESS_*_CLIENT_ID` fromOp lines to bosun-agent; deploy. Verify from an off-network device: dashboard unreachable without the token; the iPad still loads it unattended; reboot the iPad and confirm self-load.

### Rollback one-liner

If the panel goes dark after cutover: remove `access:` from `web` and `accessFloor: accessFloor()` from the `stack()` opts in `deploy.config.ts`, then redeploy (`git push`, or `bosun up` directly on the box, the advisory reconcile + manual path bypasses the edge). The Block floor and the dashboard gate disappear on the next reconcile.

> **Verify-before-cutover (load-bearing):** confirm CF evaluates a `*.worldwidewebb.co` Block app + a `dashboard.worldwidewebb.co` allow app so dashboard is allowed (specific app wins) while every other subdomain is blocked. If precedence does NOT hold, the default-deny invariant degrades to explicit per-host Block apps (a product decision, flag to Calum, don't silently swap). Confirm live in step 2/3 before the dashboard cutover.

---

## Part 9: Secrets summary

1Password (Homelab vault) is the source; `bosun` resolves via the `op` provider, materializes label-scoped docker secrets, prunes orphans. Root of trust = the op service-account token seeded at bootstrap (only secret not from gitops; for local runs the agent uses your own `op` session). No secret value ever in git, CI, images, or the config.

---

## Part 10: Bootstrap (one-time, idempotent)

Preconditions (already true on the Mini): OrbStack, Tailscale (approved), HA VM, a GitHub deploy key. Plus two creds pre-saved in 1Password (Homelab): the **GHCR pull token** (`scripts/save-ghcr-pull-token.sh`) and the **Portainer admin** password (`scripts/save-portainer-admin.sh`). bootstrap fails fast with the save-script to run if either is missing.

`scripts/bootstrap.sh` is a single idempotent, self-contained run:

1. verify the prereq secrets exist in 1Password
2. `docker swarm init` (if not active)
3. start the **Portainer** service (monitoring only; publishes host-local `9000` so bootstrap can drive its API before cloudflared is up)
4. wait for the Portainer API (host-local port, falling back to the public route on existing boxes)
5. create the admin account from 1Password via `/api/users/admin/init` (already-initialised is a graceful no-op)
6. rename the auto-created `local` environment to `production` via `scripts/rename-portainer-env.sh` (bd www-4b5)
7. confirm the GHCR pull token docker secret
8. `bun run bosun up` (first full deploy)

After it completes, the only manual step is confirming OrbStack **Start at login**. **Turtle:** Portainer can't deploy Portainer and bosun can't deploy its own agent, bootstrap starts those two; bosun does the rest.

---

## Part 11: Persistence & restart survival

```
reboot → OrbStack starts at login → dockerd → Swarm restores services + secrets (Raft)
       → named volumes intact (pgdata, portainer_data) → cloudflared reconnects → live
```
No boot scripts, no sudo. The only anchor: OrbStack "start at login."

---

## Part 12: Deploy triggers

- **Automated:** push → CI builds changed images → CI POSTs the deploy webhook (`hooks.worldwidewebb.co`, HMAC/bearer) → `bosun-agent` runs `bosun up`. **CI is the trigger, the box is the executor** (correct ordering: deploy only after the image exists; CI never needs to reach the tailnet box for docker).
- **Manual / local:** run `bun run bosun up` from your machine (your `op` session + tailnet docker) for ad-hoc deploys and secret rotation.

---

## Part 13: Risks & open decisions

**Risks**
1. Portainer + bosun-agent hold the docker socket = root-equivalent. Acceptable on a single personal box.
2. Single node = no redundancy.
3. Code-change latency is build-bound.
4. OrbStack-at-login is the persistence anchor.
5. Swarm is in maintenance (stable, not growing).
6. `bosun` is new code, its prune logic is the dangerous part; it MUST be label/tag-scoped and unit-tested before pointing at the real swarm.
7. Portainer publishes host-local `:9000` (bootstrap drives its API before cloudflared is up). This exposes the UI on the host's LAN/Tailscale interfaces, and the unauthenticated `admin/init` endpoint is briefly open on first boot until bootstrap claims it. Acceptable on a single personal box already fronting Portainer via Cloudflare; bootstrap inits the admin immediately, so the open-init window is seconds.

**Open decisions**
1. `dashboard.worldwidewebb.co` public, or wall panel tailnet-only? (Doc assumes public route; harmless to add.)
2. Auto-deploy via CI→webhook now, or manual `bosun up` first? (Doc specifies webhook; agent may land manual first and mark the auto items accordingly.)

**May need Calum (mark `[-]` with reason if blocked, don't fake):** creating brand-new 1Password items (Portainer admin, op service-account token, GHCR pull PAT), the OrbStack start-at-login toggle, GHCR package visibility/pull auth.

---

## Part 14: Implementation order (roadmap for the agent)

1. **Build `bosun`** in `packages/bosun` with unit tests: spec API, config loader (pure eval), providers (op/file/env), reconcilers (secrets+prune, routes+prune, stack), health prober, CLI. Green typecheck + tests.
2. **Write `deploy.config.ts`** for control-center (Part 6).
3. **Dockerfiles** for web/api/storybook (+ web reverse-proxy, + api migrate-on-boot).
4. **CI workflow** (path-filtered → GHCR + webhook call).
5. **Bootstrap** swarm + Portainer + bosun-agent; confirm OrbStack-at-login.
6. **`bosun up`** → deploy the stack; reconcile Cloudflare routes.
7. **Verify** every acceptance item; drive the checklist to done; leave `main` clean.

---

## Part 15: Acceptance criteria

See **[`docs/acceptance-checklist.md`](./acceptance-checklist.md)**, the definition of done. Self-executable, no sudo, `[ ]`/`[-]`/`[x]` protocol (an item is `[x]` only after its test actually ran and passed; skips are `[-]` with a reason).
