# Control-Center Deployment — Acceptance Checklist

> **This checklist is the definition of done.** Implement the system per the design doc
> [`docs/deployment-design.md`](./deployment-design.md), then drive every item below to `[x]`.
>
> **Done means done — no bullshit:** the work is complete only when every item is `[x]` (or honestly `[-]` with a reason) **and** `main` is checked out and clean (see `ac_main_clean`). No stranded branches, no uncommitted WIP, no half-states.

---

## How to read & update this file (MANDATORY — read before touching any item)

Every item is in **exactly one** of three states:

| Marker | Meaning |
|---|---|
| `[ ]` | **todo** — not started, or its test has not yet passed |
| `[-]` | **skipped** — could not be completed; **MUST** carry a parenthesized reason inline, e.g. `[-] ac_foo … (reason: requires a full OS reboot, declined)` |
| `[x]` | **done** — the item's exact test was **actually run** and **met its pass condition** |

**HARD RULES — non-negotiable:**

1. **`[x]` requires evidence.** Mark an item `[x]` only after running its test and observing the pass condition. Evidence before assertion, never assert a check passed without running it.
2. **You may NOT skip an item by marking it `[x]`.** If something cannot be done, the only honest marker is `[-]` **with a written reason**. Marking a skipped item as done is forbidden.
3. **Do not delete, reword, or weaken an item to make it pass.** Unfinished stays `[ ]`. Blocked or declined becomes `[-] (reason)`.
4. **No sudo.** Every item is executable as the normal user. If an item genuinely requires root, stop and surface it as `[-] (reason: needs sudo — <what>)`, do not work around it.
5. **One marker per item.** No partial ticks. If a test is flaky/partial, it is still `[ ]`.

**Context for the tests:** stack name `control-center`; images `ghcr.io/0x63616c/control-center-{web,api,storybook}`; host `homelab` (SSH); tooling tokens in 1Password (Homelab vault).

---

## Build & gates

- [ ] **ac_gates** — `bun run test` && `bun run typecheck` && `bunx biome check .` each exit 0. *Pass:* all three exit 0.
- [ ] **ac_images** — after a push, `gh run watch <id>` conclusion = success; then `docker manifest inspect ghcr.io/0x63616c/control-center-web:$(git rev-parse --short HEAD)` (and `-api`, `-storybook`) each resolve. *Pass:* CI green + all three `:<sha>` tags exist in GHCR for HEAD.

## Stack health (SSH homelab)

- [ ] **ac_stack_up** — `docker stack services control-center` shows all 6 services at `1/1`; `docker service ps <svc> --filter desired-state=running` has the task `Running` with no `Failed`/`Rejected` task in the latest deploy. *Pass:* every service 1/1, zero failed tasks.
- [ ] **ac_healthchecks** — for web/api/postgres, `docker service inspect <svc> --format '{{.Spec.TaskTemplate.ContainerSpec.Healthcheck}}'` is non-empty and the running container's `.State.Health.Status` == `healthy`. *Pass:* healthchecks defined and reporting healthy.

## Public ingress / HTTPS (curl/openssl from agent host)

- [ ] **ac_portainer_https** — `curl -sS -o /dev/null -w '%{http_code}' https://portainer.worldwidewebb.co` == `200`; `echo | openssl s_client -connect portainer.worldwidewebb.co:443 -servername portainer.worldwidewebb.co | openssl x509 -noout -checkend 0` exits 0. *Pass:* 200 + valid unexpired cert.
- [ ] **ac_portainer_login** — `POST https://portainer.worldwidewebb.co/api/auth` with admin creds from 1Password returns 200 + a JWT. *Pass:* API auth succeeds.
- [ ] **ac_storybook** — `curl -sS https://storybook.worldwidewebb.co` → 200 and body matches `grep -qi storybook`. *Pass:* 200 + Storybook marker.
- [ ] **ac_tunnel** — Cloudflare API `GET /accounts/$ACCT/cfd_tunnel/$TID` (token from `op://Homelab/Cloudflare API`) → `result.status == "healthy"`; no public hostname returns 521. *Pass:* tunnel healthy, no 521s.

## App correctness (agent-browser + curl)

- [ ] **ac_dashboard_render** — agent-browser loads the dashboard at exactly **1366×1024**, screenshot taken; DOM has zero skeleton/shimmer elements after load settles. *Pass:* all tiles rendered, no shimmer, no error boundary.
- [ ] **ac_live_ha** — `curl` the api's HA-backed tRPC endpoint (climate/now) over the swarm; response is a real numeric reading, not an error. *Pass:* live HA value returned, and the matching tile shows that number in the `ac_dashboard_render` screenshot.

## Security / isolation

- [ ] **ac_no_secrets_git** — for each secret value (`op read`), `git log -p --all | grep -F "<value>"` returns nothing; `gitleaks detect --no-banner` → 0 findings; `stack.yml` references `/run/secrets/*` and `docker secret ls` lists them. *Pass:* zero secret values in tree/history; all sourced from docker secrets.
- [ ] **ac_no_inbound** — `docker service inspect`/`docker ps` show no `control-center` service publishing to a non-loopback/non-tailnet host interface; cloudflared publishes no host port (outbound-only). *Pass:* no public inbound listener; ingress only via the tunnel.
- [ ] **ac_api_private** — there is no `api.worldwidewebb.co` route and `api` publishes no host port; the api is reachable only proxied under `web` at `/api`. *Pass:* api not directly public; `/api/*` works through `web`.

## Persistence / resilience (SSH homelab)

- [ ] **ac_pg_persists** — `docker exec <pg> psql -c "create table _ac_probe(id int); insert into _ac_probe values(1);"` → redeploy the stack → `select count(*) from _ac_probe` still returns 1. *Pass:* data survives a full redeploy (named volume intact). Cleanup drops the probe table.
- [ ] **ac_restart_recovers** — `orb restart`, then poll until `docker stack services control-center` is all `1/1` and `ac_portainer_https` + `ac_storybook` pass again; throughout, HA VM pid (`pgrep -f haos.qcow2`) is unchanged and `tailscale status` stays connected. *Pass:* stack self-recovers with no manual step; HA + Tailscale untouched. (Engine restart, **not** a full OS reboot.)
- [ ] **ac_autostart** — verify OrbStack is configured to start at login (login-item / `orb` setting check). *Pass:* autostart confirmed enabled. (Verify-only; if off, surface as `[-]` with reason — do not fail silently.)

## Deploy speed (end-to-end, agent-driven)

- [ ] **ac_config_speed** — push a benign `stack.yml` change (add a label), time push → `docker service inspect web` shows the new label. *Pass:* reflected in < 30 s (config path, no build), measured.
- [ ] **ac_code_auto** — push a trivial code change (alters image content); `gh run watch` to success; new GHCR `:<sha>` exists; `docker service inspect web` image digest updates to it with **no manual step**. *Pass:* code change auto-builds and auto-redeploys end-to-end.
- [ ] **ac_rollback** — `docker service update --image ghcr.io/0x63616c/control-center-web:<prev-sha> control-center_web` → service healthy on the prior version → roll forward again. *Pass:* rollback to a prior sha succeeds and recovers.

## Global done (capstone — verify LAST)

- [ ] **ac_main_clean** — `git branch --show-current` == `main`; `git status --porcelain` is empty (no uncommitted or untracked files); `git status` reports up-to-date with `origin/main` (all work pushed); `git stash list` is empty and no stray worktrees remain. *Pass:* on `main`, clean tree, fully pushed, nothing stranded. **The goal is not done until this passes.**
