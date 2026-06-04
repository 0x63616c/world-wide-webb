# bosun

Static, pure deploy spec for the control-center stack. Configs import the builders
in `src/spec.ts` and return a plain `Spec`; the tool consumes it at sync time. No
I/O or side effects live in the spec layer.

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
`buildJobCommand`, and `runDueJobs` (with its per-minute and in-flight guards)
take a clock and a runner, so the only impure part is the one-minute timer.

### Documented default decisions

- **Cron format.** Specs take **standard 5-field cron** (`min hour dom mon dow`),
  matched on the host wall clock (local time). A spec that passes anything other
  than 5 fields is rejected at build time.
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

## Tests

```sh
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```
