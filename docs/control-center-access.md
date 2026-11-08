# Control Center private access

Installed iPad/iPhone apps use `https://homelab.tail8c014d.ts.net`. Keep this
address independent of the host's enrollment name. The rebuilt Mini remains
`homelab-mac-mini`; Tailscale Service `svc:homelab` owns the app address and
proxies private HTTPS443 to `http://127.0.0.1:4202` on that Mini.

The root launch daemon `org.nixos.homelab-control-center-access` runs at boot
and every minute on the Mini when Control Center is assigned. It reconciles
only this service and its advertisement, rejects conflicting routes and Funnel,
and checks that unrelated Tailscale configuration remains unchanged. Host
enrollment and other services remain separately managed. Existing tailnet
access policy still applies; the app has no login or additional credentials.

## Initial setup or host replacement

1. Confirm the app's loopback health and database are healthy on the replacement.
2. If an offline retired machine owns `homelab`, rename only that retired
   machine to `homelab-retired` in Tailscale. Do not rename the enrolled Mini.
3. Define Tailscale Service `homelab` with endpoint `tcp:443`. Preserve its
   allocated virtual addresses on later host replacements.
4. Run the reconciler with the installed Tailscale executable, or allow its
   launch daemon to run. Approve only the intended Mini as a service host.
   Advertisement and host approval are separate from the local Serve route.
5. From another tailnet device, verify the original HTTPS URL and read
   `/api/v1/health`, `/api/v1/controls`, `/api/v1/tesla` and `/api/v1/climate`.
   Also verify unchanged host identity, unrelated routes and disabled Funnel.

The daemon re-advertises the service, including after restored ServeConfig.
For intentional maintenance, stop/disable this daemon before draining the
service. Removing the local service route does not remove the service's
control-plane definition or its host approval. To undo the compatibility
setup, stop the daemon, drain `svc:homelab`, and remove only this service's
local route; retain its definition for recovery. Never reset all Serve routes.

## November 8, 2026 repair evidence

After the rebuild, the old node `100.78.116.17` was offline while the healthy
app ran on `homelab-mac-mini` (`100.73.156.11`) without a Serve configuration.
The retired node was renamed without deleting its identity. `svc:homelab`
received virtual IPv4 `100.68.206.90`, and the rebuilt Mini was approved for
`tcp:443`. Its managed machine name and IP remained unchanged.

After automatic TLS certificate issuance, credential-free HTTPS requests to
the original URL from the operator Mac returned HTTP200 for health, controls,
Tesla and climate. Health reported SQLite `ok`, build
`72f9533c84cc9362b9a3df9a5fe3f079411c638d`. No physical device commands were
issued. All 120 Python operations tests and the Mini's real Nix system build
passed; independent final review accepted the route and advertisement fix.

The Mini also reported an existing `resolver/ts.net` symlink conflict in its
DNS health. HTTPS requests above passed despite that warning; this access
repair does not replace or restart its DNS configuration.
