# Control-Center Deployment Design

Status: **DRAFT for review** · Scope: build a generic config-driven deploy tool (`flotilla`) and deploy control-center to the Mac Mini (`homelab`) through it.

> **For the implementing agent:** read this whole doc, then follow **Part 14 — Implementation order**. The companion [`acceptance-checklist.md`](./acceptance-checklist.md) is the definition of done. Everything here runs as the normal user (no sudo).

---

## Part 1 — Plain English (read this first)

We're building two things at once:

1. **`flotilla`** — a small, reusable deploy tool. You describe a project's services in a typed TypeScript file (`deploy.config.ts`), and `flotilla` deploys them to a Docker Swarm: it pushes the right secrets in (from 1Password), wires up the public routes (Cloudflare), starts the containers, and then *proves they actually work* by running health checks you declared. It also **cleans up** — secrets and routes that you stop declaring get removed automatically.

2. **control-center** — the dashboard, as the first project deployed *through* `flotilla`.

The Mini runs **OrbStack** (Docker) with **Swarm** turned on (keeps containers running, restores them after reboot). **Portainer** runs purely as a **monitoring UI** (CPU/memory per service). It does **not** deploy anything — `flotilla` is the only thing that deploys.

The clever part is the config is *real code* but **pure**: `deploy.config.ts` is a TypeScript program that builds a static description and nothing else (no network, no side effects). It declares secret *references* (e.g. "api needs the HA token from 1Password"), never the secret values. So it can run anywhere, in CI, locally, on the box, and always produces the same description with no secrets in it. The actual secret *values* are read once, at deploy time, by whichever machine has the credentials, and pushed straight into Docker's encrypted secret store.

When you push code: **GitHub Actions builds the images** (off the Mini), pushes them to GitHub's registry, then pings the Mini to run `flotilla up`. Config-only changes deploy in seconds; code changes take a build.

**Cloudflare** is untouched, the tunnel and all `*.worldwidewebb.co` routing still live in your account; `flotilla` just reconciles the routes and runs the connector. HTTPS is automatic at Cloudflare's edge.

**Three things stay on the host by hand:** Tailscale, the Home Assistant VM, and OrbStack. Everything else is declared in git and deployed by `flotilla`.

---

## Part 2 — Goals & Non-Goals

**Goals**
1. Build `flotilla`: a generic, config-driven Swarm deploy tool (typed TS manifest, pure eval, secret + route + service + health reconcile with prune).
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
5. Gold-plating `flotilla` beyond what control-center needs (build the MVP that deploys this repo; keep it tool-shaped but don't add unused backends).

---

## Part 3 — The two deliverables

| Deliverable | Where | What |
|---|---|---|
| **`flotilla`** (the tool) | `packages/flotilla/` | Generic Swarm deploy CLI + typed config API + providers + reconcilers + health |
| **control-center deploy** | `deploy.config.ts`, `apps/*/Dockerfile`, `.github/workflows/`, `scripts/` | The dashboard described and deployed through `flotilla` |

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
│  flotilla-agent   → runs `flotilla up` on trigger (deploy plane) │
│  ── app stack (deployed by flotilla) ──                          │
│  web · api · postgres · cloudflared · storybook                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 5 — The deploy tool: `flotilla`

### 5.1 What it is
A bun/TypeScript CLI at `packages/flotilla/`. Invoked from repo root as `bun run flotilla <cmd>` (add a root `package.json` script `"flotilla": "bun packages/flotilla/src/cli.ts"`). Suggested layout:

```
packages/flotilla/
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
import { stack, service, postgres, fromOp, ghcr, httpProbe, cmdProbe } from "@flotilla/spec"

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
`deploy.config.ts` **evaluates to static data and performs no I/O** — no network, no `op` calls, no reading ambient state, no nondeterminism. It declares secret/route *references*; resolution happens later in the tool. `flotilla plan` must produce **byte-identical** output on repeated runs and contain **zero secret values**. Optionally snapshot the resolved static spec to `deploy.lock.json` for a diffable record.

### 5.4 Commands
| Command | Does | Touches secret *values*? |
|---|---|---|
| `flotilla plan` | evaluate config → print the static Spec (refs, not values) | ❌ pure |
| `flotilla secrets sync` | resolve refs via provider → create declared docker secrets, **prune** orphaned (scoped) | ✅ |
| `flotilla routes sync` | reconcile Cloudflare tunnel routes from `route:` decls, **prune** orphaned (scoped) | uses CF API token |
| `flotilla up` | `plan` → `secrets sync` → `routes sync` → render + `docker stack deploy --prune` → `verify` | ✅ |
| `flotilla verify` | run every declared health probe; exit 0 iff all pass; print per-probe report | ❌ |
| `flotilla serve` | webhook receiver: runs `up` on an authenticated POST (HMAC/bearer) | ✅ |

### 5.5 Reconcile semantics (with safe prune)
- **Secrets:** docker secrets are immutable. The tool names each `cc_<name>_<shorthash-of-value>` and labels them `flotilla.stack=control-center`. Sync: create any missing hashed secret, render the stack to reference the *current* hashed names, then **prune** only secrets carrying the stack label that are no longer referenced. Changed value → new hash → new secret → service rolls → old pruned. **Prune is label-scoped** so it can never delete another stack's or Portainer's secrets.
- **Routes:** create Cloudflare public-hostname routes for declared `route:` values (via CF API, token from 1Password) pointing at `service:port`; **prune** only routes tagged/owned by this stack. Routes stay remote-managed; unmanaged hostnames are never touched.
- **Services:** render Spec → `stack.yml` → `docker stack deploy --prune control-center` (Swarm adds/updates/removes services to match).
- **Health:** see 5.7.

### 5.6 Secrets — the three-plane model + providers
- **Build plane (CI):** builds images. No app secrets.
- **Config plane (anywhere):** evaluates the config. Pure, refs only, no values.
- **Sync plane (one privileged place):** resolves refs → values → docker secrets. Runs where creds + swarm coexist: **locally** (your `op` session + tailnet) or **on the box** (`flotilla-agent` with a 1Password service-account token). **Never** a cloud CI runner (can't reach the tailnet-only Mini, has no 1Password).
- **`SecretProvider` interface:** `op` (default), `file` (local), `env`. A declared ref like `op://Homelab/Home Assistant Token/credential` resolves through whichever provider the environment configures — "somewhere can be local."

### 5.7 Health probes
Each service declares probes; `flotilla verify` runs them and is the gate. Probe kinds:
- `httpProbe(url, expectStatus, { certValid? })` — HTTP status (and optional cert validity).
- `cmdProbe(desc, shellCmd)` — command exits 0.

`flotilla up` runs `verify` after deploy; on failure it reports per-probe and (optional) auto-rolls the failed service back to its previous image. Many checklist items are satisfied by declared probes that `verify` runs.

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

1. Tunnel `evee-webhooks` (remote-managed); routes reconciled by `flotilla routes sync`, never hand-edited.
2. Outbound-only; **no inbound ports** on the Mini.
3. HTTPS at Cloudflare's edge via free Universal SSL → **single-level hostnames only** (`*.worldwidewebb.co`). All public names single-level: `dashboard.`, `storybook.`, `portainer.`, `hooks.`.
4. Routes target swarm `service:port`. Deploy webhook is a path under `hooks.worldwidewebb.co` → `flotilla-agent`.

---

## Part 9 — Secrets summary

1Password (Homelab vault) is the source; `flotilla` resolves via the `op` provider, materializes label-scoped docker secrets, prunes orphans. Root of trust = the op service-account token seeded at bootstrap (only secret not from gitops; for local runs the agent uses your own `op` session). No secret value ever in git, CI, images, or the config.

---

## Part 10 — Bootstrap (one-time, idempotent)

Preconditions (already true on the Mini): OrbStack, Tailscale (approved), HA VM, a GitHub deploy key.

```sh
# scripts/bootstrap.sh
set -e
docker info 2>/dev/null | grep -q "Swarm: active" || docker swarm init
# Portainer (monitoring only)
docker volume create portainer_data
docker service create --name portainer --publish 9000:9000 \
  --constraint 'node.role==manager' \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  --mount type=volume,src=portainer_data,dst=/data \
  portainer/portainer-ce:<pinned>
# First flotilla deploy (run locally or from the agent)
bun run flotilla up
```
Then set Portainer admin (API), confirm OrbStack start-at-login. **Turtle:** Portainer can't deploy Portainer and flotilla can't deploy its own agent — bootstrap starts those two; flotilla does the rest.

---

## Part 11 — Persistence & restart survival

```
reboot → OrbStack starts at login → dockerd → Swarm restores services + secrets (Raft)
       → named volumes intact (pgdata, portainer_data) → cloudflared reconnects → live
```
No boot scripts, no sudo. The only anchor: OrbStack "start at login."

---

## Part 12 — Deploy triggers

- **Automated:** push → CI builds changed images → CI POSTs the deploy webhook (`hooks.worldwidewebb.co`, HMAC/bearer) → `flotilla-agent` runs `flotilla up`. **CI is the trigger, the box is the executor** (correct ordering: deploy only after the image exists; CI never needs to reach the tailnet box for docker).
- **Manual / local:** run `bun run flotilla up` from your machine (your `op` session + tailnet docker) for ad-hoc deploys and secret rotation.

---

## Part 13 — Risks & open decisions

**Risks**
1. Portainer + flotilla-agent hold the docker socket = root-equivalent. Acceptable on a single personal box.
2. Single node = no redundancy.
3. Code-change latency is build-bound.
4. OrbStack-at-login is the persistence anchor.
5. Swarm is in maintenance (stable, not growing).
6. `flotilla` is new code — its prune logic is the dangerous part; it MUST be label/tag-scoped and unit-tested before pointing at the real swarm.

**Open decisions**
1. `dashboard.worldwidewebb.co` public, or wall panel tailnet-only? (Doc assumes public route; harmless to add.)
2. Auto-deploy via CI→webhook now, or manual `flotilla up` first? (Doc specifies webhook; agent may land manual first and mark the auto items accordingly.)

**May need Calum (mark `[-]` with reason if blocked, don't fake):** creating brand-new 1Password items (Portainer admin, op service-account token, GHCR pull PAT), the OrbStack start-at-login toggle, GHCR package visibility/pull auth.

---

## Part 14 — Implementation order (roadmap for the agent)

1. **Build `flotilla`** in `packages/flotilla` with unit tests: spec API, config loader (pure eval), providers (op/file/env), reconcilers (secrets+prune, routes+prune, stack), health prober, CLI. Green typecheck + tests.
2. **Write `deploy.config.ts`** for control-center (Part 6).
3. **Dockerfiles** for web/api/storybook (+ web reverse-proxy, + api migrate-on-boot).
4. **CI workflow** (path-filtered → GHCR + webhook call).
5. **Bootstrap** swarm + Portainer + flotilla-agent; confirm OrbStack-at-login.
6. **`flotilla up`** → deploy the stack; reconcile Cloudflare routes.
7. **Verify** every acceptance item; drive the checklist to done; leave `main` clean.

---

## Part 15 — Acceptance criteria

See **[`docs/acceptance-checklist.md`](./acceptance-checklist.md)** — the definition of done. Self-executable, no sudo, `[ ]`/`[-]`/`[x]` protocol (an item is `[x]` only after its test actually ran and passed; skips are `[-]` with a reason).
