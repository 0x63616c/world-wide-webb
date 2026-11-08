# Linux runner validation

November 8, 2026. Implementation is on `codex/linux-runners`, based on private main
`676d662`. The existing production controller was not replaced or activated by
these checks. Linux admission remains off pending image promotion and mixed-load
validation.

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

## Remaining acceptance gates

- Build and inspect the immutable derived image from the final reviewed source;
  verify private registry visibility and credential-free cache staging/clone.
- Exercise preparation/JIT/job completion/cancellation and restart cleanup through
  the actual updated controller, including mixed macOS/Linux ownership.
- Repeat network controls with macOS/Linux peers and record any remaining IPv6
  control limitations explicitly.
- Compare representative four-Linux and two-macOS/two-Linux build throughput against
  the two-job baseline, including pressure, swap, thermal and disk-growth samples.
- Build the final Nix host generation and run the final source checks before
  activating the profile and routing application jobs to it.
