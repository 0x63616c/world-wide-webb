# Linux runners and four job capacity on homelab macbook

Plan dated November 8, 2026. Extend the existing disposable Tart runner controller
to support Linux ARM64, with four total jobs and at most two macOS guests. Linux
can use all four slots when no eligible macOS jobs are waiting. Keep one controller,
one durable journal and one host resource budget.

## Baseline and live capacity

This checkout is on `codex/homelab-cleanup` at `d8952f6`, before runner support.
Implementation must start from current main, not recreate the controller here.
The locally available `origin/main` is `676d662` (PR 29, runner concurrency).
Code was inspected in the clean `homelab-runner-concurrency` worktree at
`5a80d060eb0cf0c0300cd39098d609d2a63f4419`, which is an ancestor of that main.
Recheck main before implementation. Unrelated working changes remain untouched.

Read-only SSH to `admin@homelab-macbook.local` confirmed:

- Apple M2 Pro, model Mac14,10; 12 physical/logical CPU cores, split 8 performance
  and 4 efficiency. Older repository comments saying only M2 are incomplete.
- 32 GiB physical RAM. At inspection, about 27 GiB was on the VM free-page list,
  swap usage was zero, and `memory_pressure -Q` reported 96% system-wide free
  percentage. These are different measurements, not interchangeable RAM counts.
- About 329 GiB available on the data filesystem. This supersedes the earlier
  migration inventory's 172 GiB for this point-in-time capacity estimate.
- AC power; no recorded thermal or performance warning from `pmset -g therm`.
  Load averages were about 1.6, 1.6 and 2.0. No active Tart guest process appeared
  in the process sample; this was an idle baseline, not a throughput benchmark.
- `org.nixos.homelab-runner` is running as a system LaunchDaemon. Its policy
  enables admission and two concurrent jobs, using the pinned Tahoe/Xcode image,
  4 vCPUs/8192 MiB per guest, 140 GiB admission threshold and 80 GiB emergency floor.
  The installed revision JSON contains null, so it cannot prove an exact source
  commit; live settings agree with the inspected concurrency implementation.

The two-macOS-guest ceiling is specific to macOS, rather than a reason to cap all
guests at two. See the [Tart maintainer answer](https://github.com/openai/tart/discussions/1054).
Tart separately supports [Linux images on Apple silicon](https://tart.run/quick-start/).
The proposed four-job ceiling is a host capacity policy requiring measurement.

## Starting resource policy

- macOS ARM64: 4 vCPUs and 8 GiB RAM, preserving the current Xcode allocation.
- Linux ARM64: 2 vCPUs and 4 GiB RAM, using an inspected, digest-pinned Ubuntu
  image. Ubuntu 24.04 is the initial target if its selected image meets the contract.
- Host totals: at most 4 owned attempts, at most 2 macOS guests, at most 12
  allocated vCPUs and 24 GiB allocated guest RAM. The remaining 8 GiB accommodates
  macOS, virtualization overhead and other host processes; it is not guaranteed
  unused memory. Virtual CPUs share physical cores, including efficiency cores.

This admits 2 macOS + 2 Linux (12 vCPUs, 24 GiB), 1 macOS + 3 Linux (10 vCPUs,
20 GiB), or 4 Linux (8 vCPUs, 16 GiB). Four copies of the current 8-GiB macOS
allocation would leave no host RAM and must not be used as a generic default.
Larger Linux jobs may need an explicit larger profile later; the resource budget
can then reduce concurrency without changing the global maximum.

Count starting, listening, running and cleaning attempts against limits until
their resources are authoritatively absent. Preserve reservations after crashes
and unknown outcomes. Account for other manually running macOS VMs when checking
the platform ceiling; unknown inventory blocks new admissions.

Replace the current uniform disk reservation formula with per-profile growth
reservations plus the host emergency floor and explicit image staging allowance.
Currently `scheduler.rs` reserves the 60-GiB admission/emergency gap per owned
attempt: a fourth admission would need 320 GiB free, almost all today's headroom
before caching Linux. Do not merely raise the job limit and retain that formula.
Keep the 80-GiB emergency floor initially; measure Linux image, clone, Docker and
build growth to set its reservation. Admission requires current free space to cover
the emergency floor, remaining image staging allowance, existing attempts'
remaining growth and the candidate's growth allowance. Current usage is already
reflected in free space; do not also reserve that consumed growth. Derive remaining
growth from enforced storage bounds and trusted host accounting, including clone
copy-on-write behavior and host-side artifacts. If a tighter bound cannot be proven,
reserve the full allowance conservatively and report the resulting capacity limit.

Using provisional 60-GiB macOS and 24-GiB Linux growth allowances plus 20 GiB for
image staging gives 268 GiB for 2 macOS + 2 Linux or 196 GiB for 4 Linux at admission
before any of that guest growth has been consumed. These are planning examples,
not measured image sizes or steady-state free-space requirements. Enforce guest
disk size limits and verify actual free space after caching both images. Coordinate
cache pulls/pruning with admission: reserve downloads before starting them, retain
images needed by active attempts, and never prune an active clone to recover space.

Pause new admissions on sustained host memory pressure or swap growth, with
hysteresis to avoid oscillation. Continue cleanup and existing jobs. Missing
resource observations block new admissions; ordinary high CPU utilization alone
should not prevent queued jobs from making progress. Begin with fixed budgets;
add dynamic sizing only if measurements justify it.

## Scheduling and routing

Use explicit profiles, initially `macos-arm64` and `linux-arm64`. Retain the
existing `homelab-tart` label's macOS meaning for compatibility. Route Linux with
`runs-on: [self-hosted, Linux, ARM64, homelab-linux]`. Register each JIT runner
with the selected profile's full labels. Requests using only the old routing
label must continue selecting macOS; conflicting or ambiguous requests fail closed.

GitHub dispatches independently of controller discovery. Both profiles advertise
`self-hosted` and `ARM64`, so a workflow requesting only those generic labels can
land on either OS even when the controller refuses to provision for that request.
Before mixed-platform rollout, audit every runnable workflow in each allowed
repository, including reusable and dynamically selected workflows, and require an
explicit OS or unique profile routing label. Reject underspecified routes in the
workflow check. A post-assignment platform check cannot undo incorrect dispatch;
the workflow audit is a rollout prerequisite.

When both platforms have eligible demand, give macOS the next available capacity
until up to two macOS slots are occupied or reserved. Linux uses the remaining
capacity and may borrow all four slots when no macOS work is waiting. If macOS
arrives while four Linux jobs run, let existing jobs finish and give the released
capacity to macOS; do not cancel useful work. Stop admitting replacement Linux
jobs into capacity reserved for the waiting macOS demand. Reserve corresponding
RAM/CPU as well as slot count, so smaller Linux guests cannot fragment the budget.
An image-unready or otherwise ineligible macOS job must not reserve capacity
indefinitely. Preserve repository fairness within each platform.

Reserve only uncovered demand. Deduplicate eligible queued jobs by repository,
run ID, run attempt and job ID. Subtract compatible starting/listening attempts
already covering that demand; cap new macOS reservations at two minus the number
of owned macOS attempts. Thus two starting macOS attempts must not reserve two
more slots and block Linux. Refresh coverage after actual GitHub assignments,
including assignment to a job other than the original candidate, and remove
cancelled or externally assigned demand promptly. Apply waiting reservations to
Linux admission, not as extra charges that prevent the reserved macOS job itself
from starting. On partial/stale discovery, block new admissions while existing
attempts continue to reconcile.

Capacity reservations are demand hints, not guarantees that GitHub assigns a
particular job to a runner. Actual server assignment remains authoritative and
must satisfy the runner's platform and repository scope. Bound waiting by the
existing job timeout; immediate preemption is outside this plan.

## Code changes

Paths below refer to the newer runner implementation on main, absent here.

1. `runner/src/config.rs`, `modules/runners.nix`, `hosts/homelab-macbook.nix`:
   replace the single image/CPU/RAM policy with typed platform profiles; separate
   `maxConcurrentJobs = 4` from `tart.maxMacOSGuests = 2`; add host CPU/RAM and
   per-profile disk reservations. Keep Linux admission off until its validation
   gates pass. Existing macOS-only configurations must remain loadable.
2. `runner/src/github.rs`, `scheduler.rs`, `service.rs`: replace duplicated
   macOS-only label checks (`LABELS`, `supported_profile`, `supported`) with one
   profile resolver used by discovery, revalidation, admission and JIT creation.
   Add global and per-OS accounting, borrowing and macOS queue reservations.
   `Config::validate`, `RuntimeConfig::validate`, Nix option types/assertions and
   `flake.nix` currently all enforce the generic 1-to-2 limit and need coordinated
   changes. Keep the actual macOS ceiling at two.
3. `runner/src/state.rs`, `store.rs`: version and migrate the journal so each
   attempt snapshots its platform/profile, image, resources and relevant guest
   runtime identity. Missing legacy profile means macOS, never infer Linux from
   a current config. Existing attempts must remain cleanable after profiles change
   or disappear. Define downgrade behavior: drain to idle before reverting to a
   controller that cannot read the new journal, and provide an explicit safe idle
   conversion if needed; never silently discard active records.
4. `runner/src/tart.rs`: retain shared clone/boot/lease/stop/delete machinery and
   extract OS-specific guest preparation. Current code hardcodes UID 501,
   `/Users/admin/actions-runner`, staff/wheel groups, launchd plists, `scutil` and
   `networksetup`. Linux needs verified user/home/UID, systemd supervision, Linux
   hostname/DNS configuration, dependency checks and Linux runner paths. Do not
   weaken guest identity checks to accept any non-root UID.
5. `runner/src/guest.rs`, `src/bin/homelab-runner-guest.rs`: preserve the bounded
   one-shot JIT input, peer-UID checks, safe status schema and independent service
   supervision. Much of this is Unix code already; compile and exercise it on
   Linux. `start_runner` clears the environment and sets Darwin-specific PATH and
   admin identity variables: derive USER, LOGNAME, HOME and a minimal Linux PATH
   from the verified guest profile, and test tool discovery under the actual
   systemd service environment. Replace launchd-only assumptions in documentation
   and fixtures. A guest service restart must never execute a previously accepted
   JIT payload again.
6. `packages/runner.nix`, `flake.nix`: the only fetched archive is currently
   `actions-runner-osx-arm64`, and the uploaded helper is a Darwin executable.
   Add a checksum-pinned official Linux ARM64 runner archive and a Linux ARM64
   helper artifact with verified runtime dependencies outside the host Nix store.
   Build the Linux helper in Linux CI/a disposable build VM, or use a verified
   cross-build; selecting `--bin` in a Darwin build does not produce Linux code.
   Keep the Darwin host controller, signed Tart bundle and host keychain setup.
7. New `runner/images/linux/` recipe and Linux systemd unit: pin the base image,
   guest agent and tool versions, configure public DNS, install runner dependencies,
   Git, certificates and Docker where required. Publish a reproducible derived OCI
   image by digest, without runner registration or host credentials. Include image
   promotion and refresh instructions. Do not share the production Colima daemon,
   Docker socket, host directories or caches with job guests.
8. Extend `runner/tests/scheduler.rs`, adapter/guest tests, `tests/vm_e2e.rs`,
   Nix checks and operator status/diagnostics for platform, limits, resource use,
   queue reservations and admission-block reasons. Keep drain/hold/update behavior
   fleet-wide across both platforms. No public setup CLI schema change is needed
   for these host-owned runner options.

## Linux transport and workflow compatibility

Prefer the current `tart exec` control channel instead of introducing guest SSH.
Upstream now packages [Linux ARM64 guest-agent builds](https://github.com/openai/tart-guest-agent/blob/main/.goreleaser.yml)
and an [admin-user systemd RPC service](https://github.com/openai/tart-guest-agent/blob/main/packaging/tart-guest-agent.service).
That is evidence for feasibility, not proof of compatibility with our pinned
Tart 2.41.1 or a particular Ubuntu image. The first implementation gate must pin
an agent version and prove stdin, exit status, deadlines and reconnection through
that version of Tart. Inspect the actual image rather than assuming the agent is
installed. If incompatible, evaluate a narrowly scoped Tart/agent upgrade before
adding a separate SSH path or weakening isolation.

Linux jobs must be native ARM64 initially. GitHub requires Linux with Docker for
[container actions and service containers](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).
Run Docker inside each disposable Linux guest; its privileges stay inside that VM.
Preserve Softnet host/LAN/tailnet/peer restrictions and verify public DNS/HTTPS.
Docker does not require nested hardware virtualization for ordinary containers.

The local `world-wide-webb/.github/workflows/ci.yml` has suitable early candidates:
unit tests, typechecking and the already ARM64 image build. Other Ubuntu jobs
download `linux.amd64` SOPS/age archives and need ARM64-aware downloads before
routing here. Audit action binaries, browser dependencies, cache keys (include
architecture), image platforms, runner tools and deployment networking per job.
Local application workflows may lag GitHub; refresh before edits. Do not route
deployment jobs needing mini/tailnet access through an isolated build guest.
In this repository, keep Darwin Nix checks on macOS: the flake currently exports
Darwin checks. `hindsight-recovery.yml` already targets Ubuntu ARM64, but this repo
also needs GitHub App access and an approved allowlist entry before local routing.

## Delivery and acceptance

1. Prove a pinned Linux image/agent/helper contract with a disposable VM. Validate
   non-root identity, systemd, runner version and native ARM64 container execution.
2. Implement profile-aware config, labels, journal migration and guest preparation
   with Linux disabled. Run existing lifecycle tests and new mixed-platform tests.
3. Add four-slot scheduling and resource reservations. Deterministically test
   4 Linux, 2 macOS + 2 Linux, rejection of a third macOS/fifth total attempt,
   memory/disk exhaustion, unknown inventory, fairness, four-Linux-to-waiting-macOS
   transitions and queued macOS cancellation. Cover generic/ambiguous workflow
   labels, deduplicated demand, two already-starting macOS attempts, alternate
   server assignments, and disk admission before/after guest growth and image
   caching. A waiting macOS job gets the next suitable released capacity; no new
   Linux job repeatedly overtakes it.
4. Exercise cancellation, controller kill/restart, transport loss, guest crash,
   reboot and configuration changes with mixed guests. Confirm no JIT replay,
   unrelated VM deletion or leaked registration; retain the existing startup
   operation leases and ASIF inventory race protections.
5. Validate under the real `_runner` LaunchDaemon before GUI login. Repeat positive
   public-network controls and blocked host/LAN/tailnet probes; include Linux to
   Linux and Linux to macOS peer probes in both directions, IPv4 and IPv6.
6. Complete the routing audit before canarying real repositories. Canary one Linux
   job, then measure four Linux and two macOS plus two Linux
   using representative Bun tests, ARM64 Docker builds and Xcode jobs. Compare
   wall time and completed jobs/hour against the existing two-job baseline; record
   memory pressure, swap delta, disk growth, CPU and thermal behavior. Four-job
   capacity passes only if jobs complete reliably, pressure is not sustained,
   swap does not keep growing, disk stays above the floor and aggregate throughput
   improves. Reduce the CPU/RAM budget or concurrency if mixed builds regress.
7. Enable four total/up to two macOS after the load gate, migrate selected workflow
   jobs individually, and document larger-job limits and rollback. Keep the image
   cache and controller logs bounded. Rollback first disables new Linux admission,
   drains all attempts and restores a compatible config/journal.

Recommendation: implement the user's flexible four-slot policy. The measured
hardware makes it a credible target with 8-GiB macOS and 4-GiB Linux guests;
whether four simultaneous real builds improve throughput remains the load gate.
This planning work changed no host configuration or workflow routing.

## Implementation refinements

The Linux helper is built inside the image rather than uploaded from a Darwin
package. Private registry authentication stays on the operator's Mac; a verified
pinned cache bundle is staged to the node before its image pin changes. This
preserves unattended cached clones without adding a registry credential to the
node. Native component and network evidence, rollout status and remaining gates
are recorded in [Linux runner validation](research/linux-runner-validation.md).
