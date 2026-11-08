# Linux runners and shared capacity

The MacBook controller supports four owned attempts across both platforms and
at most two macOS guests. Each macOS guest defaults to 4 vCPUs/8 GiB; Linux uses
2 vCPUs/4 GiB. Host budgets are 12 vCPUs/24 GiB guest RAM. Four Linux jobs may
borrow all capacity; eligible uncovered macOS demand takes the next suitable
released slot without interrupting existing jobs. Starting and cleaning attempts
retain their reservations.

## Image promotion

Use the manual **Build Linux runner image** workflow on a reviewed source revision.
It uses a checksum-pinned signed Tart 2.41.1 bundle, a digest-pinned Ubuntu 24.04
base, guest agent 0.15.0 and Rust 1.99.0. The helper is compiled inside Linux and
baked into the image. The host controller never uploads a Darwin executable into
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

The build workflow needs permission to publish the GHCR package. The controller
also needs to pull it: verify anonymous access if the package is public, or use a
separately reviewed host registry credential arrangement for a private package.
No registry token, password-manager credential, Actions registration or host secret
belongs in the image. The helper service is installed by the controller only on
a fresh clone. The image disables SSH at future boot and uses public DNS because
production Softnet blocks the private gateway. Job Docker runs inside that guest.

For a local reviewed image build, authenticate Tart to the destination registry
and run from the repository root:

```sh
python3 runner/images/linux/build-image.py \
  --destination ghcr.io/OWNER/homelab-linux-runner:source-REVISION
```

The builder uses its own temporary Tart inventory and deletes its exact local VM
and cache after completion. It never operates on the production runner inventory.

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
[Linux runner validation](research/linux-runner-validation.md). Linux remains off
in the checked-in host profile until an image digest has passed promotion and the
four-guest load gate. The shared capacity and macOS ceiling are separately defined;
leaving Linux off does not permit a third macOS guest.
