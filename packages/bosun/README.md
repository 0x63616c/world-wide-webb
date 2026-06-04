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

## Scheduled jobs (Ofelia)

Cron tasks (migrations, cleanup, backups) are declared with `cronJob()` and run by
a single **Ofelia** scheduler pod, driven entirely by Docker labels — no new deploy
mechanism. A job is just a normal `ServiceSpec` carrying a `schedule`, so it reuses
the existing secret/env/command rendering and gets op-resolved secrets for free.

```ts
import { cronJob, ofeliaController, stack } from "@bosun/bosun/src/spec.ts";

stack("control-center", {
  services: [
    ofeliaController(), // the scheduler itself, reconciled like any service
    cronJob("prune", {
      image: "docker:cli",
      schedule: "30 3 * * *", // standard 5-field cron
      command: "docker system prune -af",
      jobType: "job-run", // default; "job-exec" runs inside a live container
    }),
  ],
});
```

`renderStackYml` emits the schedule as Ofelia deploy labels alongside the usual
`bosun.stack=` label:

```
- bosun.stack=control-center
- ofelia.job-run.prune.schedule=0 30 3 * * *
- ofelia.job-run.prune.command=docker system prune -af
```

### Documented default decisions

- **Cron format.** Specs take **standard 5-field cron** (`min hour dom mon dow`).
  Ofelia wants 6 fields (leading seconds), so bosun translates by **prepending
  `0 `** at render time. Specs stay conventional; nobody tracks the seconds column.
  A spec that passes 6 fields is rejected at build time.
- **Verify semantics.** One-shot jobs are **exempt from liveness `HealthProbe`
  verify** — a one-shot has no endpoint to poll, so `cronJob()` attaches no probes
  and rejects an http probe as nonsensical. (A future last-run-exit-0 check could
  query Ofelia's last task state; out of scope here.)

### Why Ofelia, and the tradeoffs

- **Scheduler-pod model.** One `mcuadros/ofelia` controller reads job schedules from
  the `ofelia.*` deploy labels other services emit. It is declared as bosun-managed
  infra (`ofeliaController()`) so it is reconciled, not a hand-placed snowflake.
- **Node-local job-exec/job-run caveat.** `job-exec` (exec into a running container)
  and `job-run` (spin up a one-shot container) only see the Docker daemon Ofelia is
  attached to. Fine on our single-node swarm; use `job-service-run` (cluster-aware,
  not implemented here) if we ever go multi-node.
- **Socket / SPOF tradeoff.** The controller mounts `/var/run/docker.sock`
  (root-equivalent) and sits behind a `node.role==manager` placement constraint. One
  scheduler is a single point of failure for **all** schedules. Accepted for homelab.

## Tests

```sh
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```
