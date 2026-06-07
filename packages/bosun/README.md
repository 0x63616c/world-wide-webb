# bosun

Static, pure deploy spec for the control-center stack. Configs import the builders
in `src/spec.ts` and return a plain `Spec`; the tool consumes it at sync time. No
I/O or side effects live in the spec layer.

## The model

bosun is a small bun/TypeScript CLI (`src/cli.ts`) with four layers:

- **spec** (`src/spec.ts`) — typed builders (`service`, `postgres`, `cronJob`,
  `fromOp`, `ghcr`, health probes) that `deploy.config.ts` imports to return a
  pure `Spec`. No I/O, so it evaluates identically anywhere (CI, the box, a test).
- **reconcile** (`src/reconcile/*`) — turn the `Spec` into reality and prune
  orphans: `secrets.ts` (op-resolved values → hashed docker secrets),
  `routes.ts` (Cloudflare tunnel ingress), `stack.ts` (render → `docker stack
  deploy`).
- **health** (`src/health.ts`) — declared probes (`httpProbe`, `cmdProbe`,
  `certProbe`) run with injected fetch/exec, so they're testable.
- **serve / scheduler** (`src/serve.ts`, `src/scheduler.ts`) — the long-lived
  `bosun-agent`: a webhook receiver that runs `bosun up` on deploy, plus the
  in-process cron scheduler.

### `bosun up` (deploy + secrets)

`bosun up` resolves every declared secret ref from 1Password via the `op` CLI,
reconciles them into hashed docker secrets (`<stack>_<NAME>_<hash>`, label-scoped
prune), renders the stack, and runs `docker stack deploy --prune
--with-registry-auth`. Secret resolution is **serialized** in `OpProvider`:
concurrent `op read`s would race on op's daemon/config init on a fresh container
and corrupt it, so reads are chained one at a time (CC-ykj).

Commands: `plan` (print the Spec, no secrets) · `secrets sync` · `routes sync` ·
`up` (full deploy) · `verify` (run probes) · `serve` (webhook + scheduler) ·
`run-job <name>` (fire one cron job now).

## Health probes

Each service declares a `health: HealthProbe[]`. Probes run via `runProbes`
(`src/health.ts`) with an injected fetcher (http) and runner (cmd), so they are
testable without real network or processes.

| Builder | Kind | Asserts |
| --- | --- | --- |
| `httpProbe(url, expectedStatus)` | `http` | the URL returns `expectedStatus` |
| `cmdProbe(description, command)` | `cmd` | the shell command exits 0 |
| `certProbe(host, { warnDays, port? })` | `cmd` | the TLS cert is valid and not expiring within `warnDays` |

### Cert-expiry probe

Connect-time TLS validation (an `httpProbe` over https) only fails *after* a cert
has already expired. `certProbe` warns *before* expiry: it wraps openssl's
`-checkend`, which exits non-zero when the leaf cert expires within the warn
window, so the probe goes red while there is still time to renew.

```ts
import { certProbe, service } from "@bosun/bosun/src/spec.ts";

service("web", {
  // ...
  health: [
    // Fail the check once the cert is within 14 days of expiry.
    certProbe("dashboard.worldwidewebb.co", { warnDays: 14 }),
    // Non-443 origin:
    certProbe("origin.internal", { warnDays: 30, port: 8443 }),
  ],
});
```

`port` defaults to `443`. Under the hood it runs:

```sh
echo | openssl s_client -connect <host>:<port> -servername <host> 2>/dev/null \
  | openssl x509 -checkend <warnDays*86400> -noout
```

The `-servername` (SNI) flag is required so SNI-routed hosts return the correct
cert. The probe needs `openssl` on the host running the checks.

> Note: public routes are fronted by Cloudflare and auto-renew, so a `certProbe`
> is only meaningful against a self-managed origin cert.

## Scheduled jobs (bosun-native scheduler)

Cron tasks (cleanup, migrations, backups) are declared with `cronJob()` and run by
**bosun's own scheduler**, which lives inside the long-lived `bosun serve` agent —
no third-party scheduler container, no Docker labels. A cron job is a `ServiceSpec`
carrying a `schedule`, but it is **not** deployed as a long-lived stack service:
`renderStackYml` excludes it, and the scheduler runs it on its cron as a one-shot
**Swarm job** (`docker service create --mode replicated-job`).

```ts
import { cronJob, stack } from "@bosun/bosun/src/spec.ts";

stack("control-center", {
  services: [
    cronJob("prune", {
      image: "docker:cli",
      schedule: "30 3 * * *", // standard 5-field cron
      command: "docker system prune -af",
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
      placement: ["node.role==manager"],
    }),
  ],
});
```

### How it runs

`bosun serve` (the deploy webhook agent) also calls `startScheduler()`. Once a
minute it matches each job's 5-field cron against the wall clock (`cronMatches`,
`src/scheduler.ts`) and, for each due job, runs:

```
docker service rm <stack>-cron-<job> >/dev/null 2>&1; \
docker service create --mode replicated-job --restart-condition none \
  --name <stack>-cron-<job> --with-registry-auth \
  --label bosun.cron-job=<job> [--constraint …] [--mount …] [--env …] \
  <image> <command>
```

`--mode replicated-job` runs the task to completion and then stops (no restart
loop). Each run removes the prior (completed) job service of the same name and
recreates it, so there is exactly one entry per job — its last-run state visible
in `docker service ls` / `docker service ps <stack>-cron-<job>` between runs.

The scheduler is pure/injected for tests: `cronMatches`, `dueCronJobs`,
`buildJobCommand`, and `runDueJobs` take a clock, a runner, and a `JobInspector`,
so the only impure part is the one-minute timer.

### Crash recovery (restart-safe, no in-memory state)

The scheduler holds **no** in-memory run-state. Both guards — "did this slot
already run?" and "is a run still in flight?" — are read from swarm each tick via
the injected `JobInspector`, so a scheduler that dies mid-run and is restarted by
swarm makes the same decision its predecessor would have. The run itself is never
owned by the scheduler: it is a Swarm task swarm keeps running and reaps
regardless of the scheduler's liveness.

Two mechanisms make this work:

- **Slot label.** When a job fires for wall-clock minute *M*, its service is
  stamped `--label bosun.cron-slot=<M>` (`slotKey`). On the next tick the
  inspector reads that label back; if it equals the current slot, the job is
  skipped — so a restart inside minute *M* cannot double-fire it.
- **In-flight read.** The inspector also checks `docker service ps` for a task in
  a non-terminal state; a long run spanning the restart is left alone until it
  completes.

Crash windows resolve cleanly: killed *after* create → restart sees the slot
label → skip (no double-fire); killed *between* the `rm` and `create` → no
service → fire (at-least-once). An inspector error skips the tick rather than
firing blind; the next 30s tick retries. Every decision is logged
(`already ran slot …`, `still in flight …`, `running … slot …`) so a recovery is
verifiable from `docker service logs control-center_bosun-agent`.

> Limit: this recovers from *scheduler* death. A hard host reboot mid-run does
> not auto-resume a `restart-condition none` task — recovery there is the next
> scheduled slot, so **jobs must be idempotent**.

### On-demand runs (`bosun run-job <name>`)

To fire a job immediately instead of waiting for its cron — for verification, a
backfill, or an ad-hoc re-run — use:

```sh
bun run bosun run-job docker-image-prune
```

`run-job` selects the cron job by name (`selectCronJob`, erroring loudly on an
unknown name or a non-cron service) and runs the **same** `buildJobCommand()`
invocation the scheduler issues, so a manual run is byte-identical to a scheduled
one. The resulting `<stack>-cron-<job>` replicated-job is visible in Portainer
and `docker service ps`. Point it at a remote swarm with a docker context, e.g.
`DOCKER_HOST=ssh://homelab bun run bosun run-job docker-image-prune`.

### Documented default decisions

- **Cron format.** Specs take **standard 5-field cron** (`min hour dom mon dow`),
  matched on the host wall clock (local time). A spec that passes anything other
  than 5 fields is rejected at build time.
- **Timezone.** Cron is interpreted in the **agent container's local timezone**,
  which the `bosun-agent` image pins to `TZ=America/Los_Angeles` (with `tzdata`
  baked in so the IANA zone resolves). So `0 3 * * *` fires at 03:00 **LA local**,
  off-peak — not 03:00 UTC (~8pm LA, on-peak), which is what an unset TZ would give
  on the UTC host (CC-dd0). The scheduler matches `Date.getHours()`/`getDate()`
  etc., which honour `TZ`, so **DST is handled automatically** by the IANA zone:
  the same `0 3 * * *` stays at 03:00 local across the PST↔PDT switch. To run a
  job in a different zone, change `TZ` on the agent service.
- **Service naming.** The one-shot job service is named `<stackName>-cron-<job>` —
  derived from the stack name so the stack is the single namespace source of truth
  (no magic prefix). It lives outside the deployed stack because it is created
  imperatively on a schedule, not by `docker stack deploy`.
- **Verify semantics.** One-shot jobs are **exempt from liveness `HealthProbe`
  verify** — a one-shot has no endpoint to poll, so `cronJob()` attaches no probes.

### Live ops note: nightly Docker image cleanup

`deploy.config.ts` declares one production cleanup job today, built on the
`cronJob()` primitive (no hand-written stack yaml):

```ts
cronJob("docker-image-prune", {
  image: "docker:cli",
  schedule: "0 3 * * *", // 03:00 local, nightly off-peak
  command: 'docker image prune -a -f --filter "until=720h"',
  volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
  placement: ["node.role==manager"],
}),
```

- **What it does.** The scheduler spins up a one-shot `docker:cli` Swarm job
  nightly that runs `docker image prune` against the host daemon, then exits.
- **Why the `until=720h` filter, not a bare `prune -af`.** `-a` removes *all*
  unused images (not just dangling), but the `until=720h` age filter caps it at
  images older than 30 days. The Mini re-pulls images on every deploy, so an
  unbounded prune would evict things we still actively use or just pulled. `-f`
  skips the confirmation prompt a non-interactive job cannot answer.
- **Socket privilege.** The job mounts `/var/run/docker.sock` (read-write — prune
  mutates) so it can shell `docker`, and pins to a manager node so the socket is
  the swarm's daemon. This is the same root-equivalent exposure the agent carries.
- **Verifying on the homelab.** The schedule fires at 03:00; to confirm a run,
  check `docker system df` before/after, and look for the
  `control-center-cron-docker-image-prune` job in `docker service ls` (labelled
  `bosun.cron-job=docker-image-prune`). Reclaimed space shows as a drop in the
  *Images* reclaimable column.

### Tradeoffs

- **One scheduler.** The scheduler runs in the single `bosun serve` agent, a
  single point of failure for all schedules — accepted for the homelab. A missed
  minute (agent down/restarting) skips that run until the next match, same as a
  host cron daemon.
- **Node-local jobs.** A job mounting the docker socket pins to a manager node so
  it shells the swarm's daemon. Fine on the single-node swarm.

## Deploy: digest pinning (CC-czg)

The CI deploy webhook (`POST /deploy/<stack>`) carries the per-image digest map
CI just built: `{"images": {"control-center-bosun": "sha256:…", …}}`. `bosun serve`
forwards it into `cmdUp` → `renderStackYml`, which rewrites each of our
`ghcr.io/0x63616c/<name>:main` images to `…@sha256:<digest>` (`pinImage`).

Why: a `docker stack deploy` of an unchanged `:main` string is a no-op spec, so
the service does **not** roll — unless `--resolve-image` re-resolves `:main` to
the new digest, which silently failed for the self-deploying `bosun-agent`
(symptom: agent stuck on the old image, needing a manual `service update
--force`). A digest is unique per build, so the spec string changes and swarm
always rolls **exactly** the rebuilt services (un-overridden images keep `:main`
and don't roll). CI reads each `:main` digest with `docker buildx imagetools
inspect`. A missing/legacy body (no `images`) falls back to the `:main` tags, so
manual `curl` triggers still work.

## Routes sync (Cloudflare tunnel)

A service that declares `route: "name.worldwidewebb.co"` is published through the
Cloudflare tunnel. `routes sync` (`src/reconcile/routes.ts`) reconciles **both**
halves needed for a hostname to resolve, and `bosun up` runs it automatically on
every deploy (after the stack deploy, so origins exist first) — zero manual CF
steps (CC-vqyv):

1. **Tunnel ingress** — there is no per-rule create/delete API and ingress rules
   carry no tag, so `reconcileRoutes` GETs the whole ingress array, mutates it
   (add declared hostnames → their `http://<service>:<port>` origin, drop ones
   bosun manages that are no longer declared, keep the catch-all last), PUTs it
   back. Prune ownership is derived from the rule's origin.
2. **Public DNS** — `reconcileDns` upserts a **proxied `CNAME` →
   `<tunnelId>.cfargotunnel.com`** for each declared hostname (the zone wildcard
   `*.worldwidewebb.co` is a dead A-record, NOT the tunnel, so a hostname without
   its own CNAME 521s even with the ingress rule present — this is what bit the
   `drizzle` service). Prune is scoped to CNAMEs whose hostname is a stack-owned
   ingress route, so a foreign hostname sharing the tunnel target (e.g.
   `portainer`) is never touched.

Both reconciles are **advisory on the webhook deploy path** (a CF hiccup logs a
warning but never aborts an otherwise-good stack deploy, exactly like verify);
the interactive `routes sync` / `up` exits non-zero on failure. The CF
identifiers (`CF_ACCOUNT_ID` / `CF_ZONE_ID` / `CF_TUNNEL_ID`) reach the agent via
`fromOp()` on the bosun-agent service → the entrypoint exports them to env; the
API token is resolved from op (`Cloudflare API/credential`) at reconcile time.

## `postgres()` helper

`postgres({ volume, secretRef, db?, image?, config?, init? })` builds the postgres
service: it mounts the named data volume, wires the password as
`POSTGRES_PASSWORD_FILE` (docker secret, never an env literal), and sets
`POSTGRES_DB` (defaults to the api's `control_center`). `POSTGRES_DB` is honoured
by the image **only on a fresh volume init**, so it is inert against existing data
— safe to add to the live spec without forcing a destructive re-init (CC-chy).

> The `config[]` (postgresql.conf) and `init[]` (initdb scripts) options are
> accepted by the builder but **not yet emitted** by the renderer — tracked in
> CC-sg9.

## Agent image

`packages/bosun/Dockerfile` builds the `bosun-agent` runtime (`oven/bun:1-alpine`).
Unlike `apps/api` it is **not** bundled: `bosun serve`/`up` import
`deploy.config.ts` at runtime and shell out, so the image ships the bosun source
tree plus the tools it needs:

- `docker` + `op` CLIs (copied from their official multi-arch images) — run
  `docker stack deploy`/`docker secret` against the host daemon (socket
  bind-mount) and resolve `op://` secrets.
- `curl`, `jq`, `postgresql-client` — the `cmdProbe`s the agent's own `bosun up`
  verify shells out to; without them probes exit 127 and verify is structurally
  red (CC-z65).
- `tzdata` + `ENV TZ=America/Los_Angeles` — so the scheduler's wall clock is LA
  local (CC-dd0).

The entrypoint (`docker-entrypoint.sh`) bridges docker secret files
(`/run/secrets/<NAME>`) into the env vars the CLIs read (`OP_SERVICE_ACCOUNT_TOKEN`,
`BOSUN_WEBHOOK_TOKEN`), logs in to GHCR with `GHCR_PULL_TOKEN` so
`--with-registry-auth` can pull updated images, then `exec`s `bosun serve`.

## Tests

```sh
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```
