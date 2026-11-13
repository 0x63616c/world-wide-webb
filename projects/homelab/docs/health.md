# Runtime health contract

`homelab-health` invokes the typed Rust host operation installed by Nix. It performs read-only
Docker inspections for assigned services and uses one two-minute deadline,
including subprocess timeouts. General service reconciliation invokes it under
the shared operation lock, so a backup cannot deliberately stop a service during
that check. The automatic-update transaction also invokes this health path;
both hosts keep the updater disabled pending rollout validation.

Only services whose runtime is enabled are assigned. Every assigned container
must be running. The gate requires Docker's healthy status for Control Center,
PostgreSQL, Bambuddy, its slicer, Hindsight and HA; missing health data fails.
For the two containers without Docker healthchecks it also requires:

- cloudflared's native `tunnel ... ready` check against its existing VM-local
  metrics address, `127.0.0.1:20241`;
- the Bambuddy Tailscale sidecar's backend to be Running, its own node online,
  assigned tailnet IPs, and no reported health problems. Peer details are omitted.

These commands run inside the existing containers, with no new sidecar or
published port. Docker inspection projects only running/health/image fields;
health-log payloads are not captured. Errors identify fixed container names and
retain a meaningful failure when the shared retry budget expires.

For Control Center, the command additionally requires:

- app and PostgreSQL image references match the Git release manifest;
- `/healthz` returns a successful HTTP status and reports database `ok` and `stopping: false`;
- its worker-cycle flag matches `homelab.containers.controlCenter.workersEnabled`;
- `/trpc/health.buildHash` returns a successful HTTP status and the manifest's exact source revision.

These application probes follow the existing `world-wide-webb` release script,
verified against current GitHub source. The inspected live mini reports workers
on. The new configuration defaults them off until the old production owner is
stopped and ownership transfer is reviewed. The configured HA origin defaults
to the observed `http://192.168.0.130:8123`; isolated rehearsals must override it
or keep integrations disabled so they cannot control real devices.

Nine Rust tests cover the complete assigned-service checks, missing Docker
health data, exact Control Center identities, sidecar/tunnel readiness, bounded
execution, private-output handling and malformed configuration. The checked
JavaScript probe is exercised with synthetic HTTP replies, including failures;
its requests have five-second abort signals. These tests do not substitute for
target-machine checks. The live Control Center has advanced beyond the declared
baseline; see the dated drift note in current-state.md before cutover.
Before deployment readiness, add authenticated HA entity/integration checks,
Bambuddy printer/slicer and Tailscale identity checks, Hindsight API/data checks,
tunnel origin checks, and host SSH/Tailscale/headless-boot checks. A passing
empty service inventory proves nothing about a machine with no services enabled.
