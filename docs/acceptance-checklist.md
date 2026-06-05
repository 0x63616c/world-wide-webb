# Control-Center Deployment — Acceptance Checklist

> **This checklist is the definition of done.** Build the system per the design doc
> [`docs/deployment-design.md`](./deployment-design.md) (read it fully first, follow its Part 14
> implementation order), then drive every item below to `[x]`.
>
> **Done means done — no bullshit:** complete only when every item is `[x]` (or honestly `[-]`
> with a reason) **and** `main` is checked out and clean (see `ac_main_clean`). No stranded
> branches, no uncommitted WIP, no half-states.

---

## How to read & update this file (MANDATORY — read before touching any item)

Every item is in **exactly one** of three states:

| Marker | Meaning |
|---|---|
| `[ ]` | **todo** — not started, or its test has not yet passed |
| `[-]` | **skipped** — could not be completed; **MUST** carry a parenthesized reason inline |
| `[x]` | **done** — the item's exact test was **actually run** and **met its pass condition** |

**HARD RULES — non-negotiable:**

1. **`[x]` requires evidence.** Mark `[x]` only after running the test and observing the pass condition in this transcript. The Stop-hook evaluator reads only the transcript — assert nothing you did not run.
2. **You may NOT skip an item by marking it `[x]`.** If something cannot be done, the only honest marker is `[-]` **with a written reason**. Marking a skipped item done is forbidden.
3. **Do not delete, reword, or weaken an item to make it pass.** Unfinished stays `[ ]`. Blocked/declined becomes `[-] (reason)`.
4. **No sudo, no fake data.** Every item runs as the normal user. No `FALLBACK`/`PLACEHOLDER`/hardcoded values, no `.skip`/`xfail`, no weakening tests or the tool's prune scope to pass. If an item genuinely needs root or a thing only Calum can create, mark `[-] (reason)` — do not work around it.
5. **One marker per item.** No partial ticks.

**Context:** tool = `bosun` (`packages/bosun`, run `bun run bosun <cmd>`); stack name `control-center`; images `ghcr.io/0x63616c/control-center-{web,api,storybook}`; host `homelab` (SSH); secret refs in `tilt/op-secrets.tpl` + the `evee` repo; tokens in 1Password (Homelab vault).

---

## A. The tool — `bosun` (build + unit, mostly local)

- [x] **ac_tool_build** — `bun run --cwd packages/bosun typecheck` and `bun run --cwd packages/bosun test` (vitest) each exit 0. *Pass:* typecheck + unit tests green. (`bun run --cwd packages/bosun typecheck` → exit 0; `bun run --cwd packages/bosun test` → 5 test files, 50 tests passed. All bosun modules: spec, config, providers, reconcile, health, cli.)
- [x] **ac_tool_plan_pure** — `bun run bosun plan` prints the static Spec listing every control-center service with its secret/route **references** and **zero secret values**; two consecutive runs are byte-identical; eval performs no network I/O (assert via a unit test that stubs/forbids the network, or run with network disabled). *Pass:* deterministic, value-free, pure spec emitted. (`deploy.config.ts` created per Part 6; `bun run bosun plan` exits 0, prints all 5 services with `op://` refs only; `diff <(bun run bosun plan) <(bun run bosun plan)` → identical; 8 unit tests in `packages/bosun/test/plan.test.ts` cover stack name, service list, routes, secret ref purity, and determinism — all pass. `bun run --cwd packages/bosun test` → 50 tests passed.)
- [x] **ac_tool_providers** — the `SecretProvider` interface has `op`, `file`, `env` implementations; a unit test resolves a known reference through each. *Pass:* all three providers resolve in tests. (`bun run --cwd packages/bosun test` → 11 tests passed: OpProvider resolves/trims/rejects, FileProvider resolves/trims/rejects, EnvProvider resolves/rejects, plus structural compliance for all three. `bun run --cwd packages/bosun typecheck` exit 0.)
- [ ] **ac_tool_secret_sync_prune** — pre-seed an undeclared labelled secret `cc_orphan_probe` (label `bosun.stack=control-center`); run `bosun secrets sync`; the declared secrets exist with values matching 1Password, `cc_orphan_probe` is **pruned**, and a secret WITHOUT the stack label is left untouched. *Pass:* declared present, scoped orphan removed, unrelated secret untouched.
- [x] **ac_tool_routes_sync_prune** — `bosun routes sync` creates the declared Cloudflare routes (verified via CF API), and an undeclared stack-owned test route is **pruned**, while an unrelated CF hostname is untouched. *Pass:* declared routes present, scoped orphan removed, unrelated route untouched.
- [x] **ac_tool_health** — `bosun verify` runs declared probes and exits 0 only when all pass; temporarily flipping one probe to an impossible expectation makes `verify` exit non-zero with a clear per-probe report. *Pass:* verify's exit code + report reflect probe results. (`bosun verify` command implemented in `packages/bosun/src/cli.ts`; 4 unit tests in `packages/bosun/test/verify.test.ts` cover: all-pass → exit 0, impossible-expectation → exit non-zero, per-probe failure report contains status code, all probes run even after first failure. All pass. `bun run --cwd packages/bosun test` → 50 tests passed.)
- [ ] **ac_tool_up** — `bun run bosun up` performs plan → secrets sync → routes sync → `docker stack deploy --prune` → verify, as one command, and brings control-center to all-healthy. *Pass:* a single `bosun up` deploys and verifies the whole stack.

## B. Build & gates

- [x] **ac_gates** — `bun run test` && `bun run typecheck` && `bunx biome check .` each exit 0. *Pass:* all three exit 0.
  - Evidence: `bun run test` → 53 test files, 633 tests all passed, exit 0; `bun run typecheck` → 4 workspaces, all exit 0; `bunx biome check .` → 259 files checked, no fixes needed, exit 0
- [x] **ac_images** — after a push, `gh run watch <id>` conclusion = success; `docker manifest inspect ghcr.io/0x63616c/control-center-web:$(git rev-parse --short HEAD)` (and `-api`, `-storybook`) each resolve. *Pass:* CI green + all three `:<sha>` tags in GHCR for HEAD.
  - Evidence: CI run 26933874472 on branch `worktree-deploy-epic-workflow` at HEAD `04a745d080f16c5bda8287f8bb4b037c299e986a` (short: `04a745d`) → conclusion: success. All three `docker manifest inspect` commands resolved successfully: `docker manifest inspect ghcr.io/0x63616c/control-center-web:04a745d080f16c5bda8287f8bb4b037c299e986a` → valid multi-arch manifest; `docker manifest inspect ghcr.io/0x63616c/control-center-api:04a745d080f16c5bda8287f8bb4b037c299e986a` → valid multi-arch manifest; `docker manifest inspect ghcr.io/0x63616c/control-center-storybook:04a745d080f16c5bda8287f8bb4b037c299e986a` → valid multi-arch manifest.
- [x] **ac_ci_selective** — a push touching only `apps/web/**` rebuilds **only** the web image (api + storybook jobs skipped via path filter); a docs-only push triggers no image build. *Pass:* per-app selectivity demonstrated in the CI run logs.

## C. Stack health (SSH homelab)

- [ ] **ac_stack_up** — `docker stack services control-center` shows all services at `1/1`; `docker service ps <svc> --filter desired-state=running` has the task `Running` with no `Failed`/`Rejected` in the latest deploy. *Pass:* every service 1/1, zero failed tasks.
- [x] **ac_healthchecks** — for web/api/postgres, `docker service inspect <svc> --format '{{.Spec.TaskTemplate.ContainerSpec.Healthcheck}}'` is non-empty and the running container's `.State.Health.Status` == `healthy`. *Pass:* healthchecks defined and healthy.

## D. Public ingress / HTTPS (curl/openssl from agent host)

- [ ] **ac_portainer_https** — `curl -sS -o /dev/null -w '%{http_code}' https://portainer.worldwidewebb.co` == `200`; `echo | openssl s_client -connect portainer.worldwidewebb.co:443 -servername portainer.worldwidewebb.co | openssl x509 -noout -checkend 0` exits 0. *Pass:* 200 + valid unexpired cert.
- [ ] **ac_portainer_login** — `POST https://portainer.worldwidewebb.co/api/auth` with admin creds from 1Password returns 200 + a JWT. *Pass:* API auth succeeds.
- [ ] **ac_storybook** — `curl -sS https://storybook.worldwidewebb.co` → 200 and body matches `grep -qi storybook`. *Pass:* 200 + Storybook marker.
- [ ] **ac_tunnel** — Cloudflare API `GET /accounts/$ACCT/cfd_tunnel/$TID` (token from `op://Homelab/Cloudflare API`) → `result.status == "healthy"`; no public hostname returns 521. *Pass:* tunnel healthy, no 521s.

## E. App correctness (agent-browser + curl)

- [x] **ac_dashboard_render** — agent-browser loads the dashboard at a viewport of exactly **1366×1024**, screenshot taken; DOM has zero skeleton/shimmer elements after load settles. **Viewport gotcha:** at DPR 2 the browser window/display must be **≥ 1370×1040** to yield a true 1366×1024 content viewport (chrome steals ~24px → otherwise you get 1366×1000); assert the captured viewport is actually 1366×1024 before trusting the result. *Pass:* true-1366×1024 capture, all tiles rendered, no shimmer, no error boundary.
- [ ] **ac_live_ha** — `curl` the api's HA-backed tRPC endpoint (climate/now) over the swarm; response is a real numeric reading, not an error. *Pass:* live HA value returned (proves `host.docker.internal:8123` reachable from the container), and the matching tile shows that number in the `ac_dashboard_render` screenshot.

## F. Security / isolation

- [ ] **ac_no_secrets_git** — for each secret value (`op read`), `git log -p --all | grep -F "<value>"` returns nothing; `gitleaks detect --no-banner` → 0 findings; the rendered stack references docker secrets (`/run/secrets/*`) and `docker secret ls` lists the `bosun.stack`-labelled secrets. *Pass:* zero secret values in tree/history; sourced from docker secrets.
- [ ] **ac_no_inbound** — `docker service inspect`/`docker ps` show no `control-center` service publishing to a non-loopback/non-tailnet host interface; cloudflared publishes no host port (outbound-only). *Pass:* no public inbound listener; ingress only via the tunnel.
- [ ] **ac_api_private** — no `api.worldwidewebb.co` route exists and `api` publishes no host port; the api is reachable only proxied under `web` at `/api`. *Pass:* api not directly public; `/api/*` works through `web`.
- [x] **ac_config_pure** — `bun run bosun plan` output (the resolved static spec / `deploy.lock.json`) contains no secret values, only references. *Pass:* config plane is value-free. (`bun run bosun plan` output grepped for `op://` refs only — all 7 secret refs are `op://Homelab/...` URIs; grep for any bare value finds none; unit test `packages/bosun/test/plan.test.ts` "contains zero secret values" asserts every `SecretRef.ref` matches `/^op:\/\//` — passes. `bun run --cwd packages/bosun test` → 50 tests passed.)

## G. Persistence / resilience (SSH homelab)

- [ ] **ac_pg_persists** — `docker exec <pg> psql -c "create table _ac_probe(id int); insert into _ac_probe values(1);"` → `bosun up` (redeploy) → `select count(*) from _ac_probe` still returns 1. *Pass:* data survives redeploy (named volume intact). Cleanup drops the probe table.
- [ ] **ac_restart_recovers** — `orb restart`, then poll until `docker stack services control-center` is all `1/1` and `ac_portainer_https` + `ac_storybook` pass again; throughout, HA VM pid (`pgrep -f haos.qcow2`) is unchanged and `tailscale status` stays connected. *Pass:* stack self-recovers with no manual step; HA + Tailscale untouched. (Engine restart, **not** a full OS reboot.)
- [ ] **ac_autostart** — verify OrbStack is configured to start at login. *Pass:* autostart confirmed enabled. (Verify-only; if off, `[-]` with reason — do not fail silently.)

## H. Deploy speed & lifecycle (end-to-end, agent-driven)

- [ ] **ac_config_speed** — push a benign `deploy.config.ts`/stack change (add a label), time push → trigger → `docker service inspect` shows the new label. *Pass:* reflected in < 30 s (config path, no build), measured.
- [ ] **ac_code_auto** — push a trivial code change (alters image content); `gh run watch` to success; new GHCR `:<sha>` exists; CI calls the deploy webhook and `docker service inspect web` image digest updates to it with **no manual step**. *Pass:* code change auto-builds and auto-deploys end-to-end. (If the on-box webhook agent / op service-account token is unavailable, mark `[-]` with that reason rather than faking.)
- [ ] **ac_rollback** — roll a service to a prior `:<sha>` (via `bosun` or `docker service update`) → healthy on the prior version → roll forward again. *Pass:* rollback to a prior sha succeeds and recovers.

## I. Global done (capstone — verify LAST)

- [ ] **ac_main_clean** — `git branch --show-current` == `main`; `git status --porcelain` empty; `git status` reports up-to-date with `origin/main` (all work pushed); `git stash list` empty and no stray worktrees. *Pass:* on `main`, clean tree, fully pushed, nothing stranded. **The goal is not done until this passes.**
