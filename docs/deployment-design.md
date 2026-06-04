# Control-Center Deployment Design

Status: **DRAFT for review** · Scope: how control-center runs on the Mac Mini (`homelab`). Not app features.

---

## Part 1 — Plain English (read this first)

We're rebuilding how the dashboard runs on the Mac Mini, cleanly, after tearing out the old Kamal/`evee` setup.

The Mini runs **OrbStack** (its Docker engine). On top of that we turn on **Docker Swarm**, Docker's built-in "keep my containers running and bring them back after a reboot" mode. We add **Portainer**, a single tool that (a) watches this GitHub repo and redeploys when you push, (b) shows CPU/memory per service in a web UI. That one tool replaces the hand-rolled deploy poller *and* gives you monitoring.

Your app is four small containers, all declared in **one file in git** (`stack.yml`): **web** (the dashboard), **api** (the backend), **postgres** (the database), and **cloudflared** (the Cloudflare connector). Plus **portainer** and **storybook**.

When you push code, **GitHub Actions builds the image** (off the Mini, so it doesn't hog the 8 GB box), pushes it to GitHub's registry, then pings Portainer **through the Cloudflare tunnel** (no open ports on the Mini). Portainer pulls the new image and updates the stack. Config-only changes are live in **seconds**; code changes take as long as the build (~a minute or two).

**Cloudflare is untouched.** The tunnel and all the `*.worldwidewebb.co` routing still live in your Cloudflare account, we just run the connector container again and the subdomains light back up. HTTPS is automatic (Cloudflare provides the cert at its edge). **Secrets** stay in 1Password and get pushed into Docker's encrypted secret store, never into git.

**Three things stay on the host, by hand:** Tailscale (how you reach the box), the Home Assistant VM (your smart home + the dashboard's data), and OrbStack itself. Everything else lives in git and self-deploys.

**End result:** push to git → live in seconds (config) or a build away (code) → survives reboots automatically → monitored in one UI at `portainer.worldwidewebb.co` → secrets in 1Password → subdomains keep working.

---

## Part 2 — Goals & Non-Goals

**Goals**
1. Replace the torn-down Kamal/`evee` deployment with a Swarm + Portainer stack.
2. Minimal host dependencies (bottom out at OrbStack + Tailscale + HA VM).
3. Declarative: the running system matches `stack.yml` in git.
4. Fast: push → reflected in seconds for config; build-bound for code.
5. Survives reboots with no manual intervention.
6. Keep `*.worldwidewebb.co` subdomains working, zero Cloudflare-side changes.
7. Secrets sourced from 1Password, never in git.

**Non-Goals**
1. The broader `evee` platform (Slack bot, Linear agent, coding-agent, Loki/Grafana). Control-center only.
2. Multi-node / high-availability redundancy.
3. Migrating Home Assistant off the host VM.
4. Public auth (Cloudflare Access) on the dashboard, can add later.

---

## Part 3 — Architecture layers

```
┌─ HOST INFRA (manual, rarely changes) ───────────────────────────┐
│  Tailscale (system daemon)      → how you reach the box          │
│  Home Assistant (QEMU VM)       → smart home + dashboard data    │
│                                   reached at host.docker.internal:8123 │
├─ RUNTIME (one dep) ─────────────────────────────────────────────┤
│  OrbStack (start-at-login)      → Docker engine + the Swarm      │
├─ SWARM STACK (declarative, in git, self-deploys) ───────────────┤
│  portainer    → gitops + monitoring UI                           │
│  cloudflared  → outbound tunnel = public ingress, no open ports  │
│  web          → static dashboard + reverse-proxy /api → api      │
│  api          → bun backend (tRPC)                               │
│  postgres     → database, named volume                           │
│  storybook    → component explorer (keeps storybook subdomain)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 4 — Components (Swarm services)

**web**
1. Serves the built Vite static assets.
2. Reverse-proxies `/api/*` → `api` over the swarm network (one origin, no CORS).
3. Image: `ghcr.io/0x63616c/control-center-web:<sha>`, built in CI.

**api**
1. Bun tRPC server on `:4201`.
2. Reads `HA_URL=http://host.docker.internal:8123`, secrets via `/run/secrets/*`.
3. Internal only (reached through `web`); no public route by default.
4. Image: `ghcr.io/0x63616c/control-center-api:<sha>`, built in CI.

**postgres**
1. `postgres:16-alpine`, pinned.
2. Named volume `pgdata` (declared in-repo, isolated, survives redeploy/reboot).
3. Outside the deploy-reload path, never bounced by a code deploy.

**cloudflared**
1. `cloudflare/cloudflared:<pinned>`, no Dockerfile (static binary).
2. Connector token = docker secret from `op://Homelab/Cloudflare Tunnel evee-webhooks/connector_token`.
3. Routes remote-managed in Cloudflare (survive redeploys).

**portainer**
1. `portainer/portainer-ce:<pinned>`, mounts `/var/run/docker.sock` + named volume `portainer_data`.
2. Git-backed stack (watches this repo) + per-stack redeploy webhook.
3. Exposed at `portainer.worldwidewebb.co` (single-level → free auto-HTTPS).

**storybook**
1. Serves the built Storybook.
2. Exposed at `storybook.worldwidewebb.co`.

---

## Part 5 — Deploy flow

**Config / `stack.yml` change (seconds)**
```
git push → Portainer git-poll OR webhook → docker stack deploy (reconcile) → live
```

**Code change (build-bound, ~1–2 min)**
```
git push
  → GitHub Actions builds arm64 images (web, api, storybook)
  → push to GHCR as :<sha> and :main
  → CI calls Portainer redeploy webhook (through the tunnel)
  → Portainer re-pulls :main + redeploys → live
```

**Why CI builds (not on-box):** Swarm cannot build images (`docker stack deploy` ignores `build:`), so a registry is required regardless. CI keeps build CPU/RAM off the 8 GB box and versions every image in GHCR.

**Two triggers, by design:**
- **git polling / git webhook** → catches `stack.yml` structure changes.
- **CI → Portainer webhook (re-pull image)** → catches new images (git file unchanged).

**Image tagging:** stack references `:main` (moving) for auto-redeploy; every build also pushes `:<sha>` for precise rollback (`redeploy a specific sha` in Portainer). *Future option:* CI commits the `:<sha>` into `stack.yml` for pure-gitops pinning + revert-to-rollback (adds a commit loop to guard with `[skip ci]`).

---

## Part 6 — Networking & Cloudflare

1. **Tunnel `evee-webhooks`** (remote-managed, `config_src: cloudflare`) — routes live in Cloudflare, not in repo.
2. **Outbound-only:** cloudflared dials out to CF edge; public requests ride it back. No inbound ports on the Mini.
3. **HTTPS:** Cloudflare terminates TLS at the edge with the free **Universal SSL** cert. Covers `worldwidewebb.co` + `*.worldwidewebb.co` (**single-level only**). Internal hop (cloudflared → service) can be plain http.
4. **All public hostnames stay single-level** (avoids needing paid Advanced Certificate Manager):

| Hostname | → service:port |
|---|---|
| `portainer.worldwidewebb.co` | `portainer:9000` |
| `storybook.worldwidewebb.co` | `storybook:6006` |
| `dashboard.worldwidewebb.co` *(proposed)* | `web:80` |

5. **Deploy webhook** is a path under Portainer (`/api/stacks/webhooks/<uuid>`), so it rides `portainer.worldwidewebb.co`, no separate `hooks.` subdomain needed.
6. **Route → service-name coupling:** routes target swarm service names. Name services to match, or repoint routes via the CF admin token (`op://Homelab/Cloudflare API`).

---

## Part 7 — Secrets

1. **Source of truth: 1Password** (Homelab vault). Never in git.
2. **Materialized into docker secrets** by `scripts/sync-secrets.sh` (`op read` → `docker secret create`). Encrypted at rest in Swarm's Raft log; mounted into services as files under `/run/secrets/`.
3. **Immutable** — rotation = create new versioned secret → repoint service → drop old (`scripts/rotate-secret.sh`).
4. **Root of trust:** one token seeded at bootstrap (the only secret not from gitops).
5. **Secrets needed:** `HA_TOKEN`, `UNIFI_API_KEY`, `WIFI_SSID`, `WIFI_PASSWORD`, `DATABASE_URL`/`POSTGRES_PASSWORD`, the Cloudflare connector token, Portainer admin, GHCR pull token.

---

## Part 8 — Bootstrap (one-time)

Preconditions (manual, already true on the Mini): macOS + OrbStack + Tailscale (approved) + HA VM + a GitHub SSH/deploy key.

```sh
# scripts/bootstrap.sh — run once, idempotent
set -e
docker info 2>/dev/null | grep -q "Swarm: active" || docker swarm init   # single-node swarm
docker volume create portainer_data
docker service create \
  --name portainer --publish 9000:9000 \
  --constraint 'node.role==manager' \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  --mount type=volume,src=portainer_data,dst=/data \
  portainer/portainer-ce:<pinned>
```

Then (via Portainer API, can be scripted):
1. Set admin password.
2. Register the git-backed stack (repo, branch, path `stack.yml`, poll + webhook).
3. `scripts/sync-secrets.sh` to seed docker secrets from 1Password.

**The turtle:** Portainer can't deploy Portainer, so bootstrap's irreducible job is "start Portainer." Portainer does the rest.

---

## Part 9 — Persistence & restart survival

```
reboot → OrbStack starts at login → dockerd up
  → Swarm restores all services from Raft
  → secrets restored (Raft, encrypted)
  → named volumes intact (pgdata, portainer_data)
  → cloudflared reconnects → subdomains live again
```

No boot scripts, no launchd plists, no sudo. Swarm's reconciler is the boot logic. The one manual anchor: OrbStack "start at login" (replaces the hated `pm2 startup` sudo step).

---

## Part 10 — Risks & open decisions

**Risks**
1. **Portainer holds the docker socket** = root-equivalent on the host. Acceptable on a single personal box; note it.
2. **Single-node = no redundancy.** A box outage = dashboard down until reboot. Fine for a wall panel.
3. **Code-change latency is build-bound**, not webhook-bound. Can't beat the build; minimize with caching.
4. **OrbStack-at-login is the persistence anchor.** If OrbStack doesn't auto-start, nothing comes back.
5. **Swarm mode is in maintenance** (stable, not growing). Acceptable given modest needs.

**Open decisions (need Calum)**
1. `dashboard.worldwidewebb.co` as the web app's public hostname, or keep the wall panel on tailnet-only (`homelab:<port>`)?
2. Image tagging: `:main` + webhook (simple) now, or pure-gitops `:<sha>`-in-git (revert-to-rollback) from the start?
3. Keep `storybook` in prod, or dev-only?

---

## Part 11 — Acceptance criteria

Moved to its own driveable checklist: **[`docs/acceptance-checklist.md`](./acceptance-checklist.md)**.

That file is the **definition of done** for implementing this design. Every criterion there is self-executable by the agent as the normal user (no sudo), with an exact test and pass condition, and a mandatory `[ ]` / `[-]` / `[x]` status protocol (an item may only be `[x]` once its test has actually run and passed; skips must be `[-]` with a reason).
