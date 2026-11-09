# Linux runners and shared capacity

The MacBook controller supports four owned attempts across both platforms and
at most two macOS guests. Each macOS guest defaults to 4 vCPUs/8 GiB; Linux uses
2 vCPUs/4 GiB. Host budgets are 12 vCPUs/24 GiB guest RAM. Four Linux jobs may
borrow all capacity; eligible uncovered macOS demand takes the next suitable
released slot without interrupting existing jobs. Starting and cleaning attempts
retain their reservations.

## Image promotion

Run the image builder on the physical Apple silicon Mac with a reviewed source
revision and the installed signed Tart 2.41.1 bundle. GitHub-hosted macOS runners
cannot build these VMs because they [do not support nested virtualization](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); the
manual Linux runner checks workflow validates Linux code only. The image builder
uses a digest-pinned Ubuntu 24.04 base, guest agent 0.15.0 and Rust 1.99.1. The helper is compiled inside Linux and
baked into the image, alongside Rustfmt/Clippy and Python venv support for CI. The host controller never uploads a Darwin executable into
Linux. The official runner 2.338.2 Linux ARM64 archive is independently fetched
and checksum-verified through Nix during guest preparation.

The builder runs only trusted provisioning, then powers down the guest and pushes
a candidate to `ghcr.io/<owner>/homelab-linux-runner:source-<revision>`. Its JSON
output identifies the immutable image digest and source lockfile hash. Promote
that digest after inspection and native lifecycle/network/load validation; never
configure the mutable source tag. Ubuntu packages are installed from its package
repositories and recorded in `/usr/local/share/homelab/image-packages.txt`; rebuilds
can resolve newer packages, so identical source does not promise identical image
bytes. Each promoted image is immutable by digest.

The template stays private. Registry authentication is used only on the operator's
Mac while publishing or downloading it. The verified pinned cache is then preloaded
onto the MacBook, where Tart clones it without contacting the registry. No registry
credential is stored on the MacBook or copied into guests. The controller sets
`TART_NO_AUTO_PRUNE=1`; retain the active image cache across reboots. If it is lost,
hold Linux admission and preload it again before resuming.

No registry token, password-manager credential, Actions registration or host secret
belongs in the image. The helper service is installed by the controller only on
a fresh clone. The image disables SSH at future boot and uses public DNS because
production Softnet blocks the private gateway. Job Docker runs inside that guest.

On the operator's physical Mac, build a reviewed committed source revision. The
optional bundle preserves sparse disk allocation and contains only the pinned image:

```sh
python3 runner/images/linux/build-image.py \
  --destination ghcr.io/OWNER/homelab-linux-runner:source-REVISION \
  --cache-bundle linux-image-cache.tar.gz
```

Use protected Tart registry authentication or the supported `TART_REGISTRY_*`
environment credentials. Environment credentials are passed only to publication,
never the VM process or guest commands. Do not paste credential values into commands.
The builder uses its own temporary inventory and deletes the exact local VM/cache
after a confirmed stop. An unconfirmed stop preserves the inventory for reconciliation.

Before merging a new Linux image pin, transfer its bundle through SSH and install
it as `_runner`, opening the input on the administrator side of the identity drop:

```sh
sudo -u _runner /usr/bin/python3 /etc/homelab/linux/cache-image.py install \
  --tart-home /var/lib/_runner/tart --image ghcr.io/OWNER/PACKAGE@sha256:DIGEST \
  --bundle - < linux-image-cache.tar.gz
```

Installation refuses root execution, arbitrary archive paths, links, unexpected
files and existing cache replacements. It checks the manifest digest, VM metadata,
NVRAM and every uncompressed disk chunk against the pinned manifest before atomically
publishing the cache. `verify` runs the same checks on a staged cache. The installer
supports flat Linux ARM64 raw disks; it refuses external disk stacks. A changed pin
must be preloaded and verified before Comin applies the corresponding configuration.

## Enable a validated profile

Before enabling mixed platforms, run the routing audit against the exact current
workflow revisions of every allowlisted repository:

```sh
nix develop --command python3 scripts/check-runner-routes.py /path/to/repository
```

The audit rejects generic self-hosted/ARM64 labels, conflicting OS labels, dynamic
runner selection and unaudited external reusable workflows. Resolve these before
approving the audit. GitHub can independently dispatch any matching queued job;
controller discovery cannot protect an underspecified workflow after registration.
The initial `world-wide-webb` static workflow audit passed at `242eb8f4a`.

Configure a validated profile in `hosts/homelab-macbook.nix`:

```nix
homelab.runners = {
  maxConcurrentJobs = 4;
  tart.maxMacOSGuests = 2;
  cpuBudget = 12;
  memoryBudgetMiB = 24576;
  linux = {
    enable = true;
    image = "ghcr.io/OWNER/homelab-linux-runner@sha256:REVIEWED_DIGEST";
    routingAuditApproved = true;
    cpu = 2;
    memoryMiB = 4096;
    diskGrowthBytes = 25769803776;
  };
};
```

Route jobs with `runs-on: [self-hosted, Linux, ARM64, homelab-linux]`. Existing
`homelab-tart` jobs remain macOS. Audit x86 downloads, native action binaries,
container image platforms and caches before moving each workflow. Deployment
jobs requiring host/LAN/tailnet access remain outside this isolated build pool.
Darwin Nix checks still need macOS.

## Resource gates and recovery

The scheduler conservatively reserves each attempt's full disk growth allowance;
legacy records fall back to the configured admission/emergency gap. It does not
claim to measure consumed copy-on-write growth. This may admit fewer than four
jobs when disk is tight. The emergency floor remains 80 GiB on the MacBook. Cache
new images before admitting jobs and recheck space; avoid concurrent unmanaged
image pulls. Reduce capacity if real mixed workloads sustain pressure or swap.

Native host memory pressure or swap growth above 16 MiB between ten-second samples
pauses admission. Three healthy samples reopen it. Unknown telemetry blocks new
jobs; existing attempts continue cleanup. Unowned running VMs in the controller's
inventory block admission rather than being deleted. Separate user inventories
are outside this accounting; do not run unmanaged VMs alongside the pool without
reserving their CPU/RAM and macOS platform capacity.

Journal version 3 snapshots the platform, image, resources and Linux artifact
identity. Versions 1/2 migrate with a macOS default. Current-config removal never
changes the platform of an owned attempt. Update/drain covers every platform.

For rollback to a v2-only controller, first disable new admission, drain all
attempts and unload `org.nixos.homelab-runner`. While holding the offline state
lock, run the new binary's explicit conversion as root:

```sh
homelab-runner downgrade-journal --state-directory /var/lib/_runner/controller
```

The conversion refuses an active journal or loaded controller, preserves service
file ownership, and writes an idle v2 journal atomically. Restore the old controller
and macOS-only config afterward. Never erase a journal or active clone to force a
rollback.

## Validation status

Implementation checks and native Linux image evidence are recorded in
[Linux runner validation](research/linux-runner-validation.md). The candidate host profile pins the private image. Merge and activation remain
gated on the recorded native job, recovery, network and load checks. The shared capacity and macOS ceiling are separately defined;
leaving Linux off does not permit a third macOS guest.

## Operations route

The reviewed migration candidate adds a separately authorized `homelab-operations` route using
the same Linux image and isolation. See [operations runners](operations-runners.md) for admission,
queue-assignment limitations and the disabled staging canary. This route is not a live acceptance claim.

## Retired validation cache cleanup

On November 8, 2026, a root-level disk inventory found the retired canary's image cache
and original Linux validation cache outside the permanent Tart home. The canary controller
had been unloaded, its VM inventory was empty, and neither cache had open files. Both
production pinned image caches and their explicit retention markers were verified separately.
Only `/var/lib/_runner/linux-canary/tart/cache` and
`/var/lib/_runner/linux-validation/cache` were removed directly; no Tart delete/GC was run.
The stopped prepared validation VM, controller evidence, production caches and active guests
were preserved. Observed physical free space rose from218.8GiB to305.6GiB, and the permanent
controller then admitted a Linux guest alongside two running Mac guests without a policy change.

When retiring future isolated validation inventories, check their lifecycle and the independent
production cache before removing redundant caches. APFS clone sizes can overstate reclaimable
bytes; measure actual free space before/after. Keep scheduled work, resource reservations and
emergency reserves intact; do not use global image GC as an unscoped cleanup shortcut.

## Linux guest control-connection correction — November 9

The currently deployed `c1d4c31b…` image contains guest agent 0.15.0. Long-running
CI exposed [upstream issue 81](https://github.com/openai/tart-guest-agent/issues/81):
completed control RPCs leave Linux virtual sockets open until the VM service
asserts at roughly 248 connections. Two production crash reports match the
`virtio.vsock-device:0` fault; this is separate from application test failures.
A separate developer VM reproduced increasing socket counts and the crash after
240 successful probes plus readiness/measurement calls, without concurrent CI.

The local correction pins the same upstream source, adds gRPC idle-connection
cleanup and preserves active long-running RPCs. A regression test fails before
the change and passes afterward; the complete RPC/vsock suites pass. The fixed
VM survived 640 real control calls with bounded socket counts. The checked-in
source/Go checksum recipe built the same Linux ARM64 bytes as the tested binary:
`62a4bf118b926a04f7f92d44c0343619bbe680e351879bb9540a46bdc28179fe`.
No agent timer/restart workaround runs during CI jobs.

`build-image.py --refresh-guest-agent` amends only the pinned validated runner
image's agent; ordinary builds also install the fix. Registry credentials remain
host-only for private base cloning and publication. Provisioning runs in its
separate trusted unit, can restart the control agent, and retries status reads
without replaying provisioning. A private Go cache is removed before success;
the upstream license is retained in the image.

The corrected image still needs reviewed publication, cache verification, a
normal host image-pin activation and real replacement CI. Do not mark the old
image fixed or retire its recovery cache based on these local tests.
