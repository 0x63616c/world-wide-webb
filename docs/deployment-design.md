# Control-Center Deployment Design

Status: **DRAFT for review** · Scope: build a generic config-driven deploy tool (`bosun`) and deploy control-center to the Mac Mini (`homelab`) through it.

> **For the implementing agent:** read this whole doc, then follow **Part 14 — Implementation order**. The companion [`acceptance-checklist.md`](./acceptance-checklist.md) is the definition of done. Everything here runs as the normal user (no sudo).

---

## Part 1 — Plain English (read this first)

We're building two things at once:

1. **`bosun`** — a small, reusable deploy tool. You describe a project's services in a typed TypeScript file (`deploy.config.ts`), and `bosun` deploys them to a Docker Swarm: it pushes the right secrets in (from 1Password), wires up the public routes (Cloudflare), starts the containers, and then *proves they actually work* by running health checks you declared. It also **cleans up** — secrets and routes that you stop declaring get removed automatically.

2. **control-center** — the dashboard, as the first project deployed *through* `bosun`.

The Mini runs **OrbStack** (Docker) with **Swarm** turned on (keeps containers running, restores them after reboot). **Portainer** runs purely as a **monitoring UI** (CPU/memory per service). It does **not** deploy anything — `bosun` is the only thing that deploys.

The clever part is the config is *real code* but **pure**: `deploy.config.ts` is a TypeScript program that builds a static description and nothing else (no network, no side effects). It declares secret *references* (e.g. "api needs the HA token from 1Password"), never the secret values. So it can run anywhere, in CI, locally, on the box, and always produces the same description with no secrets in it. The actual secret *values* are read once, at deploy time, by whichever machine has the credentials, and pushed straight into Docker's encrypted secret store.

When you push code: **GitHub Actions builds the images** (off the Mini), pushes them to GitHub's registry, then pings the Mini to run `bosun up`. Config-only changes deploy in seconds; code changes take a build.

**Cloudflare** is untouched, the tunnel and all `*.worldwidewebb.co` routing still live in your account; `bosun` just reconciles the routes and runs the connector. HTTPS is automatic at Cloudflare's edge.

**Three things stay on the host by hand:** Tailscale, the Home Assistant VM, and OrbStack. Everything else is declared in git and deployed by `bosun`.

---

## Part 2 — Goals & Non-Goals

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

## Part 3 — The two deliverables

| Deliverable | Where | What |
|---|---|---|
| **`bosun`** (the tool) | `packages/bosun/` | Generic Swarm deploy CLI + typed config API + providers + reconcilers + health |
| **control-center deploy** | `deploy.config.ts`, `apps/*/Dockerfile`, `.github/workflows/`, `scripts/` | The dashboard described and deployed through `bosun` |

The agent builds **both**, and proves both via the checklist.

---

## Part 4 — Architecture layers

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

## Part 5 — The deploy tool: `bosun`

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

### 5.2 The manifest — `deploy.config.ts` (typed, pure)
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
`deploy.config.ts` **evaluates to static data and performs no I/O** — no network, no `op` calls, no reading ambient state, no nondeterminism. It declares secret/route *references*; resolution happens later in the tool. `bosun plan` must produce **byte-identical** output on repeated runs and contain **zero secret values**. Optionally snapshot the resolved static spec to `deploy.lock.json` for a diffable record.

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

### 5.6 Secrets — the three-plane model + providers
- **Build plane (CI):** builds images. No app secrets.
- **Config plane (anywhere):** evaluates the config. Pure, refs only, no values.
- **Sync plane (one privileged place):** resolves refs → values → docker secrets. Runs where creds + swarm coexist: **locally** (your `op` session + tailnet) or **on the box** (`bosun-agent` with a 1Password service-account token). **Never** a cloud CI runner (can't reach the tailnet-only Mini, has no 1Password).
- **`SecretProvider` interface:** `op` (default), `file` (local), `env`. A declared ref like `op://Homelab/Home Assistant Token/credential` resolves through whichever provider the environment configures — "somewhere can be local."

### 5.7 Health probes
Each service declares probes; `bosun verify` runs them and is the gate. Probe kinds:
- `httpProbe(url, expectStatus, { certValid? })` — HTTP status (and optional cert validity).
- `cmdProbe(desc, shellCmd)` — command exits 0.

`bosun up` runs `verify` after deploy; on failure it reports per-probe and (optional) auto-rolls the failed service back to its previous image. Many checklist items are satisfied by declared probes that `verify` runs.

---

## Part 6 — Control-center's manifest

`deploy.config.ts` declares: **web** (static + `/api` reverse-proxy, route `dashboard.worldwidewebb.co`), **api** (bun tRPC `:4201`, HA via `host.docker.internal:8123`, internal-only), **postgres** (pinned, `pgdata` volume, `postgresql.conf` via docker config, initdb), **cloudflared** (pinned, connector token), **storybook** (route `storybook.worldwidewebb.co`). Secret references come from the existing **`tilt/op-secrets.tpl`** (HA_TOKEN, UNIFI_API_KEY, WIFI_SSID, WIFI_PASSWORD) plus the Cloudflare connector token from the `evee` repo. New secrets (Postgres password, Portainer admin, GHCR pull token, op service-account token) get an interactive `scripts/save-<thing>.sh` per the 1Password convention.

---

## Part 7 — Images & CI

- **Dockerfiles:** multi-stage bun builds for `apps/web`, `apps/api`, `apps/web` storybook. `web` serves the static build **and** reverse-proxies `/api` → `api`. `api` entrypoint runs `bun run --cwd apps/api db:migrate` then starts the server (migrate-on-boot; Swarm crash-backoff handles ordering since it ignores `depends_on`).
- **CI (`.github/workflows/`):** on push, **path-filtered per-app** builds (`dorny/paths-filter`) → only changed apps rebuild → push `ghcr.io/0x63616c/control-center-{web,api,storybook}:<sha>` and `:main`, with buildx layer cache. Shared changes (`packages/**`, root lockfile) rebuild all. After pushing, CI calls the deploy webhook (Part 12).
- **Swarm can't build images** (`docker stack deploy` ignores `build:`), so a registry is mandatory → CI→GHCR is required, not optional. Keeps build load off the 8 GB box.

---

## Part 8 — Networking & Cloudflare

1. Tunnel `evee-webhooks` (remote-managed); routes reconciled by `bosun routes sync`, never hand-edited.
2. Outbound-only; **no inbound ports** on the Mini.
3. HTTPS at Cloudflare's edge via free Universal SSL → **single-level hostnames only** (`*.worldwidewebb.co`). All public names single-level: `dashboard.`, `storybook.`, `portainer.`, `hooks.`.
4. Routes target swarm `service:port`. Deploy webhook is a path under `hooks.worldwidewebb.co` → `bosun-agent`.

---

## Part 9 — Secrets summary

1Password (Homelab vault) is the source; `bosun` resolves via the `op` provider, materializes label-scoped docker secrets, prunes orphans. Root of trust = the op service-account token seeded at bootstrap (only secret not from gitops; for local runs the agent uses your own `op` session). No secret value ever in git, CI, images, or the config.

---

## Part 10 — Bootstrap (one-time, idempotent)

Preconditions (already true on the Mini): OrbStack, Tailscale (approved), HA VM, a GitHub deploy key. Plus two creds pre-saved in 1Password (Homelab): the **GHCR pull token** (`scripts/save-ghcr-pull-token.sh`) and the **Portainer admin** password (`scripts/save-portainer-admin.sh`). bootstrap fails fast with the save-script to run if either is missing.

`scripts/bootstrap.sh` is a single idempotent, self-contained run:

1. verify the prereq secrets exist in 1Password
2. `docker swarm init` (if not active)
3. start the **Portainer** service (monitoring only; publishes host-local `9000` so bootstrap can drive its API before cloudflared is up)
4. wait for the Portainer API (host-local port, falling back to the public route on existing boxes)
5. create the admin account from 1Password via `/api/users/admin/init` (already-initialised is a graceful no-op)
6. rename the auto-created `local` environment to `production` via `scripts/rename-portainer-env.sh` (bd CC-4b5)
7. confirm the GHCR pull token docker secret
8. `bun run bosun up` (first full deploy)

After it completes, the only manual step is confirming OrbStack **Start at login**. **Turtle:** Portainer can't deploy Portainer and bosun can't deploy its own agent — bootstrap starts those two; bosun does the rest.

---

## Part 11 — Persistence & restart survival

```
reboot → OrbStack starts at login → dockerd → Swarm restores services + secrets (Raft)
       → named volumes intact (pgdata, portainer_data) → cloudflared reconnects → live
```
No boot scripts, no sudo. The only anchor: OrbStack "start at login."

---

## Part 12 — Deploy triggers

- **Automated:** push → CI builds changed images → CI POSTs the deploy webhook (`hooks.worldwidewebb.co`, HMAC/bearer) → `bosun-agent` runs `bosun up`. **CI is the trigger, the box is the executor** (correct ordering: deploy only after the image exists; CI never needs to reach the tailnet box for docker).
- **Manual / local:** run `bun run bosun up` from your machine (your `op` session + tailnet docker) for ad-hoc deploys and secret rotation.

---

## Part 13 — Risks & open decisions

**Risks**
1. Portainer + bosun-agent hold the docker socket = root-equivalent. Acceptable on a single personal box.
2. Single node = no redundancy.
3. Code-change latency is build-bound.
4. OrbStack-at-login is the persistence anchor.
5. Swarm is in maintenance (stable, not growing).
6. `bosun` is new code — its prune logic is the dangerous part; it MUST be label/tag-scoped and unit-tested before pointing at the real swarm.

**Open decisions**
1. `dashboard.worldwidewebb.co` public, or wall panel tailnet-only? (Doc assumes public route; harmless to add.)
2. Auto-deploy via CI→webhook now, or manual `bosun up` first? (Doc specifies webhook; agent may land manual first and mark the auto items accordingly.)

**May need Calum (mark `[-]` with reason if blocked, don't fake):** creating brand-new 1Password items (Portainer admin, op service-account token, GHCR pull PAT), the OrbStack start-at-login toggle, GHCR package visibility/pull auth.

---

## Part 14 — Implementation order (roadmap for the agent)

1. **Build `bosun`** in `packages/bosun` with unit tests: spec API, config loader (pure eval), providers (op/file/env), reconcilers (secrets+prune, routes+prune, stack), health prober, CLI. Green typecheck + tests.
2. **Write `deploy.config.ts`** for control-center (Part 6).
3. **Dockerfiles** for web/api/storybook (+ web reverse-proxy, + api migrate-on-boot).
4. **CI workflow** (path-filtered → GHCR + webhook call).
5. **Bootstrap** swarm + Portainer + bosun-agent; confirm OrbStack-at-login.
6. **`bosun up`** → deploy the stack; reconcile Cloudflare routes.
7. **Verify** every acceptance item; drive the checklist to done; leave `main` clean.

---

## Part 15 — Acceptance criteria

See **[`docs/acceptance-checklist.md`](./acceptance-checklist.md)** — the definition of done. Self-executable, no sudo, `[ ]`/`[-]`/`[x]` protocol (an item is `[x]` only after its test actually ran and passed; skips are `[-]` with a reason).
