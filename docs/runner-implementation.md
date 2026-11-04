# Disposable runner implementation status

The agreed design remains one fleet-wide job slot on the MacBook, with macOS
or Linux ARM64 jobs inside fresh guests. The mini has no runner assignment.
`modules/runners.nix` still rejects enablement: the lifecycle controller and
registration broker are unfinished. No host GitHub job runner is installed.

## Version and tool evidence

Research refreshed on 2026-11-03:

- Tart release `2.41.1` supports explicit Softnet block rules, disabling
  clipboard sharing and headless operation. Source inspected at that tag;
  current main was `bcc8084a22b1ab1cc7162626537d1c6cd794cdba`.
- Softnet release `0.25.0` requires **macOS 26**, including its build SDK.
  The mini's observed 15.6 cannot run this selected version. Calum reports the reset
  MacBook runs macOS 27.2, which clears the documented minimum; compatibility
  with that exact OS and headless startup remain untested. Do not silently install a
  legacy helper or use ordinary NAT instead. Current Softnet main was
  `81b28dc7cac9bf27f4b0c9533b6980c8ac1fff9f`.
- Orchard manages Tart fleets but adds a controller/worker service and still
  requires GitHub job lifecycle integration. Its macOS local-network permission
  helper also needs explicit treatment for a headless service user.
- `KnobanLabs/macos-ephemeral-runners` was inspected at
  `fdbb3282f72d4f78c8c683f428edf2956e9b0c21`. It supports macOS/Linux pools and
  shared host capacity, but describes itself as experimental with limited
  machine testing and a preview scale-set API. It has not been adopted here.

Sources: [Tart run options](https://github.com/openai/tart/blob/2.41.1/Sources/tart/Commands/Run.swift),
[Softnet requirements](https://github.com/openai/softnet/blob/0.25.0/README.md),
[Softnet rule grammar](https://github.com/openai/softnet/blob/0.25.0/lib/proxy/rule.pest),
[Orchard](https://github.com/openai/orchard),
[alternative controller](https://github.com/KnobanLabs/macos-ephemeral-runners).

## Policy implemented, controller pending

`packages/runner-tools.nix` pins both vendor archives by SHA-256, independently
checked against downloaded release assets. `nix flake check` builds the packages
without executing either binary. Tart retains its signed app bundle and embedded
provisioning profile. Packaging grants no Softnet privileges, installs no host
runner, and cannot establish compatibility or isolation on the target MacBook.
The packages are exposed as `.#tart` and `.#softnet` for later validation.

`scripts/runner-policy.py` is a fail-closed admission/command component, not a
working scheduler. It admits only the MacBook, zero current jobs, the reviewed
Tart/Softnet versions, a digest-pinned guest template and a successful isolation
validation result. Initial guest budgets are 4 CPUs / 8 GiB for macOS and
4 CPUs / 6 GiB for Linux. It requires 80 GiB host/service headroom plus provision
for 60 GiB macOS or 40 GiB Linux guest writes. These are conservative provisional
limits, not measured requirements or enforced disk quotas.

Generated launch arguments disable graphics, clipboard, audio and USB accessory
sharing, use Softnet, and block the gateway/peers, private LAN ranges, Tailscale
CGNAT space and link-local addresses. They provide no host-folder mounts,
network allow exceptions, port exposures, nested virtualization or job-supplied
extra arguments. Five unit tests cover admission and argument construction.
The controller must discover actual host addresses, verify the selected binary
hashes/ownership, and tie isolation validation to those binaries, host OS and
network configuration. A caller-supplied boolean is not sufficient attestation.

## Remaining proof and implementation

`scripts/runner-lifecycle.py` now provides a single-host exclusive slot, a
private durable journal written before cloning, pinned-policy launch arguments,
and stop/delete cleanup after caller failure or a partial clone. Recovery only
touches the exact journaled VM; unknown local VMs or failed cleanup prevent new
jobs. Nine synthetic tests cover those paths and cross-process exclusion. These
tests do not boot Tart or prove runner isolation.

Tart commands inherit the slot descriptor so a controller crash cannot let a
new controller race an existing child. A surviving orphan VM can therefore keep
the slot occupied until an operator stops it; automatic supervisor recovery is
still unfinished. The lifecycle module has no CLI or launchd activation. Guest
readiness, job registration, logs, hard disk limits and attested admission remain
required before it can become a working runner service.

A scheduler must hold one shared slot across both OS pools and all repositories,
clone the pinned base, issue a short-lived one-job registration inside the guest,
export bounded logs, and stop/delete the guest even after cancellation or host
restart. It must never run workflow-controlled commands on macOS itself.
Credentials for obtaining registrations stay outside guests and production
service secrets are inaccessible to `_runner`.

Softnet CLI rules describe IPv4 policy. Verify IPv6, DNS, host/gateway addresses,
LAN, NAS, printer, HA, tailnet and peer reachability empirically before approving
an image. Private-address blocks do not by themselves prove every host service
is unreachable. Maintain trusted guest transport without exposing an unrestricted
host broker to jobs. Headless keychain initialization, privileged helper setup,
image integrity, crash cleanup, storage growth limits and queue fairness still
need implementation and on-target testing. Keep hosted CI for public/untrusted
PRs and x86 workloads.

No VM startup timing has been measured. The estimates in the plan remain
planning estimates; additional disk capacity does not justify increasing the
single-job limit.
