# Linux runner validation

November 8, 2026. Implementation is on `codex/linux-runners`, including private
main `0bf8d4c`. Real canary validation used a separate controller and VM inventory, with four
shared slots and at most two macOS guests. Production was held idle for these
checks; the temporary controller is now unloaded. Permanent activation and its
verification are recorded separately from the canary evidence.

## Source checks

- Rust lifecycle, guest transport, adapter, GitHub boundary and scheduler tests
  pass locally. New cases cover four Linux attempts, the fifth-attempt rejection,
  two macOS plus two Linux at the exact CPU/RAM budget, macOS priority over a
  replacement Linux job, two already-starting macOS attempts, unaudited routes,
  v2 fleet migration, Linux JIT labels, systemd guest preparation and idle rollback.
- Clippy with warnings denied and Rust formatting pass.
- Python tests pass, including the workflow route audit. Current `world-wide-webb`
  main `242eb8f4a` passes the static routing check.
- The target MacBook built the updated runner package and full MacBook Nix host
  generation without activation, including tests and the Darwin portable-helper
  library check. The separate global/macOS capacity option limits evaluated.
  The enabled Linux Nix profile also built through its compile-only fixture,
  including a verified fetch of the pinned Linux ARM64 runner archive.

## Native Linux image and four guest smoke test

A disposable Ubuntu 24.04 image was cloned from
`ghcr.io/cirruslabs/ubuntu@sha256:97166c84ea5f102be33d2959f70e83861a36bd749f1715ab669d93e6c9f31476`.
It booted as UID 451 through a system LaunchDaemon, using the installed signed
Tart 2.41.1 and root-owned Softnet 0.25.0 helper with production block rules.
No production VM inventory was reused: the test used
`/var/lib/_runner/linux-validation` as its separate Tart home.

The stock image already supported `tart exec`, reporting UID 1000, group `admin`
and `/home/admin` on aarch64. Its private gateway DNS was blocked by Softnet.
The provisioning recipe installed public DNS, guest agent 0.15.0, Docker and a
native build of the guest helper. The build completed successfully under the
`homelab-image-build.service` guest unit. After shutdown/reboot the new RPC service
started automatically; the admin user had Docker group access, the helper version
command succeeded, public GitHub HTTPS returned 200, and an Alpine container with
network disabled reported aarch64. The resolved Alpine image digest was
`sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f`.

Four clones then booted concurrently as UID 451 system LaunchDaemons, each with
2 vCPUs and 4096 MiB configured memory. Each ran two Python processes that touched
2 GiB of memory in total and hashed data continuously for 60 seconds. All four
units completed successfully. During the overlapping load, each virtualization
process consumed roughly 200% CPU and 3.4 GiB RSS; native host pressure was level 1
(normal), and swap remained zero. The per-guest output and final host sample are
in [four guest evidence](evidence/linux-four-vm-capacity.json).

This is a synthetic capacity smoke test using separate test daemons. It does not
prove the new controller's complete Linux JIT lifecycle or real CI throughput.
The production controller was idle and explicitly held during the capacity test;
all four stopped test clones and their daemons were removed, and the hold was
released afterward. The stopped prepared image remains available in the separate
test inventory for follow-up validation.

## Native guest preparation and network controls

The ignored `linux_preparation_and_one_shot_transport` test passed under a UID451
system LaunchDaemon against a separate prepared Linux clone. It used the real
pinned Linux runner archive: preparation reached Ready, an unclaimed retry stayed
Ready, and the helper accepted one synthetic invalid input. The wrapper exited;
a second input and preparation of the claimed clone were rejected. This exercised
no GitHub job or credential. The official `run.sh` wrapper returned zero despite
the invalid listener input, so wrapper exit must not be treated as job success.
See [component proof](evidence/linux-component-proof.json).

Two Linux clones passed network checks in both directions. Each reached public
GitHub HTTPS and its own IPv4/IPv6 proof listeners, while connections to the host
LAN listener, host tailnet IPv4 listener, physical router HTTPS and the other
guest's IPv4/IPv6 link-local listeners failed. Host-side controls reached the LAN,
router and tailnet IPv4 endpoints. The host tailnet IPv6 control itself timed out,
so that negative guest result is inconclusive. The independent Softnet networks
also isolate peers; these checks establish the combined architecture, not that the
filter alone caused every negative result. No macOS peer or public IPv6 control
was exercised here. See [network proof](evidence/linux-network-proof.json).

The scheduling suite now also rejects malformed Linux runner versions before
owning a slot and reserves CPU/RAM/disk for a waiting macOS job even if borrowed
Linux resources temporarily prevent it fitting. This prevents replacement Linux
jobs from repeatedly taking the resources the macOS job needs.

Private image delivery uses an operator-side authenticated publish/download and
a verified offline cache bundle. The MacBook receives image content only, with
no registry credential. Bundle checks cover path/link rejection, sparse allocation,
manifest identity, raw metadata and uncompressed disk chunk integrity.

## Private candidate and real GitHub canary

The final private candidate was built from reviewed image source `39e0ddf` and
published at `ghcr.io/0x63616c/homelab-linux-runner@sha256:c1d4c31b2576eda6adff0889e350efddda73e38a0153743f1972b5c994bcd78c`.
The package API confirms private visibility. A fresh authenticated operator-side
pull was verified and packed; the MacBook installed it as UID451 in the temporary
canary inventory `/var/lib/_runner/linux-canary/tart`, verified every manifest-bound
byte again, and cloned it without registry credentials. The production inventory
`/var/lib/_runner/tart` was subsequently preloaded and verified separately; see
[production cache proof](evidence/linux-production-cache-proof.json). Its stopped
proof clone succeeded with a cleared registry environment, was deleted, and the
cache still verified after cloning. Its booted
proof clone had Rust 1.99.1, Rustfmt/Clippy, Docker group access and aarch64 Docker,
Python venv support, the native helper and public GitHub HTTPS. The clone was then
stopped and deleted. See [private image proof](evidence/linux-private-image-proof.json).

The real canary at app revision `0dc16a972` is
[run 42524243431](https://github.com/0x63616c/world-wide-webb/actions/runs/42524243431).
All ten jobs passed in this initial smoke run. The Linux baseline jobs passed
through actual JIT registration, checkout, native
tool checks, Rust compilation/tests, artifact upload and disposable guest cleanup.
Their measured build/test times were 42.4 and 43.4 seconds. These short jobs do
not establish four simultaneous build workloads: some finish while later guests
are still starting, and GitHub may assign a different eligible job than the
controller's initial candidate. The follow-up `fd6c5e4b6` uses release builds and
adds a macOS-only baseline before the mixed cohort. Both macOS cohorts run the
production iPad build/unit tests and iPhone policy checks, with the same supported
Xcode selection and XcodeGen setup as ordinary Apple CI. Both workflow revisions pass
the explicit route audit; their changes passed independent final review and local
lint, Rust/operations checks and iPad/iPhone build/unit-policy checks.

The initial [job artifacts](evidence/linux-github-smoke-proof.json) establish
successful Linux/macOS job lifecycles, but only two Linux build workloads overlapped.
Linux and macOS measured workloads did not overlap in this short smoke run.

The corrected host controller built natively at `d540db8`; the final enabled host
generation, Linux fixture, capacity limits and process-survival check built after
incorporating PR33 at `f31128d`. See [native build proof](evidence/linux-final-nix-proof.json). Production
activation is still pending.

Ten-second host samples independently record journal ownership, CPU/RAM
reservations, VM processes, free space, pressure, swap and thermal status. Assess
actual overlap and throughput from these samples and per-job timing artifacts;
a successful matrix alone is insufficient evidence of concurrency.

Live-path inspection found two admission integration gaps after the smoke run:
revalidating only one oldest job per repository could hide macOS demand behind
older Linux work, and removing owned queued identities before listener coverage
could let one macOS listener cover two jobs. The controller now revalidates bounded
per-platform demand, preserves raw queued identities for coverage, and suspends
admission for a fresh discovery when selected cached demand has become stale.
The helper-to-scheduler regression covers older Linux demand, duplicate Mac jobs,
Linux disabled, and one Mac listener with a second queued Mac job. Full Rust tests
and Clippy pass. The heavier canary was held after its completed Linux baseline while the fix
was built and installed. The new controller acknowledged the idle hold, then
resumed later cohorts. The Linux baseline used the earlier controller; both
versions use the same guest image, resources and Linux-only admission behavior.

## Full workload, recovery and production staging

[Full canary 42525035803](https://github.com/0x63616c/world-wide-webb/actions/runs/42525035803)
passed all twelve jobs at app source `fd6c5e4b6`: two Linux release baselines, two
full Apple baselines, four Linux release builds, and two Apple/two Linux builds.
The four Linux workload intervals overlapped for 6.0 seconds; the mixed intervals
all overlapped for 84.6 seconds. The mixed batch admitted both waiting macOS
attempts before Linux, exercising the corrected live priority path.

This single trial used fresh disposable guests. Mean Linux release time was
95.7 seconds with two jobs and 97.6 seconds with four. Four-job batch throughput
was about 1.21 times the two-job baseline; guest startup/dispatch stagger limits
the gain for these short builds. With two full Apple jobs alongside Linux, mean
Linux time was 121.8 seconds and mean Apple time 416.7 seconds, about 27% and 13%
slower than their respective isolated baselines. Parallel capacity trades some
individual job speed for more simultaneous work; this is not a general benchmark.

All 192 ten-second samples spanning the workload intervals reported normal
pressure (1), zero used swap and no reported thermal/performance warning. The
highest reservation was 12 vCPUs/24576 MiB, ownership never exceeded four/two Macs,
and minimum recorded free space was approximately 295 GiB. Thermal data is the native warning status,
not a measured temperature or proof of constant CPU frequency. Raw resource
samples are retained outside Git; selected samples, their full-file digest and
all job artifacts are captured in [capacity proof](evidence/linux-github-capacity-proof.json).

[Recovery run 42528327661](https://github.com/0x63616c/world-wide-webb/actions/runs/42528327661)
held one real job per platform. Both VM/helper job processes survived a forced
controller restart with unchanged attempt/runner/job identities and a fresh
controller reconciliation. Positive helper RPCs still reported `executing`.
Both jobs were then cancelled while active; GitHub reported both cancelled,
the controller drained to an empty journal/VM inventory, and both runner
registrations were absent. See [restart proof](evidence/linux-restart-proof.json)
and [cancellation proof](evidence/linux-cancellation-proof.json).

Those recovery guests also passed Mac/Linux peer controls in both directions.
Public GitHub HTTPS and each guest's own loopback/primary IPv4/link-local IPv6
proof listeners worked; peer IPv4/IPv6, host LAN/tailnet IPv4 and router HTTPS
connections were blocked. Host controls reached the IPv4 listeners and router.
The host tailnet IPv6 target remained unavailable even to the host, so that control
is explicitly inconclusive; public IPv6 was not exercised. This proves the
combined Tart/Softnet boundary, not filter causality in isolation. The exact host
listener child was stopped/reaped and the guest listeners disappeared with their
disposable VMs. See [mixed network proof](evidence/linux-mixed-network-proof.json).

The production image cache was installed as UID451, verified against the pinned
manifest, cloned with a cleared registry environment and verified again afterward.
The stopped proof clone was deleted. No registry credential was delivered to the
MacBook. There are no owned validation guests or registered recovery runners left. The
idle temporary controller and sampler have been unloaded.

An automatic update encountered the validation maintenance hold after advancing
its boot profile. Its original stateless activation record was inspected and
completed under the real operation lock and original transaction token, with
both idle controllers unloaded before releasing the hold. Boot/live profiles
and the permanent daemon were verified before completing that record. No app
data or controller journal was reset. See [update recovery proof](evidence/linux-update-recovery-proof.json).

## Remaining rollout gates

- Merge the reviewed runner change, stop the idle temporary controller, activate
  the permanent profile and verify runtime four/two limits, the pinned Linux
  image/cache and actual job bootstrap/cleanup under the production daemon.
- Publish and pass required checks for the application CI routing change. Its
  main merge must coordinate with the separate app deployment migration: the
  existing enabled legacy Mini workflow still targets the retired SSH identity.
