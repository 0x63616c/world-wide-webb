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

## Tests

```sh
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```
