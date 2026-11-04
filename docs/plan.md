# Homelab plan

Status: proposal, November 3, 2026. Research only; no GitHub repo/PR created and
no machine configuration applied. See [current-state.md](current-state.md) for
evidence and the remaining inventory gaps.

Agreed starting point: **one local runner job at a time across the homelab**,
hosted on the MacBook. Calum confirmed approximately 500 GB storage and authorized
repository/PR implementation without deployment. Verify exact available space
before bootstrap/migration. The MacBook human administrator is `admin`; the mini
currently uses `calum`. Preserve these existing accounts.

## The idea

**`world-wide-webb` makes the app. `homelab` runs the home.**

Keep the Control Center app in its existing repository. Move the Mac mini's
operational configuration into the new private `0x63616c/homelab` repository.
There is no need to extract or rename the app repository to get a clear boundary.

Once the migration is complete, changing what runs at home means opening a
homelab PR. Merging a tested change to `main` makes it eligible for automatic
deployment. Machines converge on that configuration without a logged-in user.
Git records configuration; databases, media and machine identities remain
persistent state with separate backups.

## What each component does

- **MacBook — the first clean destination.** M2, 32 GB RAM. Bootstrap the new
  declarative system here, then migrate every retained production service from
  the mini. It temporarily runs the home while the mini is erased and rebuilt.
  Its storage is approximately 500 GB (owner-confirmed). CI must not compete with the migration.
- **Mac mini — rebuild after evacuation.** M2, 8 GB RAM. Keep the old installation
  as a fallback until the MacBook is independently verified. Then erase it,
  bootstrap it from Git, and move selected services back. Final placement remains
  open; the recommended default is stable home services here and CI on the MacBook.
  A mini runner is optional only if measurements justify it, preferably a small
  Linux VM rather than a macOS/Xcode workload.
- **Nix flake + nix-darwin — the machine recipe.** One configuration per host:
  users, tools, SSH, power, Tailscale and launchd jobs. A committed `flake.lock`
  records Nix dependency revisions. OS installation, Setup Assistant, firmware
  and Apple consent/security prompts remain outside that recipe.
- **nix-homebrew — the Homebrew installation.** nix-darwin's Homebrew options
  declare brews/casks. Prefer Nix for daemon dependencies; reserve Brew for
  software that needs it. `cleanup = "zap"` becomes safe only after all retained
  packages are declared. Brew casks do not have the same reproducibility or
  rollback guarantees as pinned Nix packages.
- **launchd — starts and supervises jobs at boot.** System daemons run with
  explicit users and homes. Startup scripts wait for their prerequisites;
  launchd alone does not provide a full dependency graph.
- **Colima + Compose — runs Linux services.** A service-owned Linux VM runs
  app containers. Compose describes images, networking, mounts and health.
  Use VZ/Rosetta for the amd64 Bambuddy slicer. Keep HA's bridged VM separate
  initially so LAN discovery keeps working.
- **Tailscale — private remote access.** Host daemon installed by Nix, with
  OpenSSH fallback and Tailscale SSH. Keep Bambuddy's separate tailnet identity.
  Migrating the GUI client is a planned access cutover, not an in-place package
  rename. Preserve existing Serve routes and resolve exit-node use first.
- **Cloudflare — existing public app access.** Preserve the app/HA/DSM tunnel
  routes and Access policies. No new router port forwards are needed.
- **SOPS + age + 1Password — secret handling.** Git stores encrypted values.
  Each host gets its age private key through 1Password once. sops-nix decrypts
  only that host's secrets into protected runtime files, never into the Nix
  store. CI builds without production secrets.
- **NAS backups — recovery of actual data.** Retain the existing consistent
  snapshots, encrypted NAS destination and hash verification. Nix rollback
  restores configuration, not a lost database or an incompatible schema change.

## Which repository owns what

**Keep in `world-wide-webb`:** application source, features, shared packages,
panel app, tests, database schema/migrations, Dockerfile and image publishing.
It remains independently buildable and usable in local development.

**Move into `homelab`:** production Compose, chosen image digests, host-specific
settings, HA startup/bridge configuration, launchd services, production secret
delivery, backup/recovery orchestration, and eventually Cloudflare edge IaC.
Move Bambuddy's deployment definition here too, then mark its old deployment
repo as superseded only after cutover.

Cloudflare's existing Pulumi state needs a controlled ownership transfer, not
a second stack that recreates its resources. Initially leave that stack in
world-wide-webb; record it as the one temporary exception. UniFi stays outside
the first rollout. Document its reservations and dependencies; a future change
can bring its supported configuration under management separately.

For each service there is one deployment owner. Moving files alone does not
transfer ownership: disable the old deploy workflow at cutover, verify it is
idle, then enable the new path. Reuse the existing release/backup locking and
health checks. Do not have two repositories reconcile the same running app.

## What happens when you change homelab

1. **Edit on a branch and open a PR.** Examples: install a tool, change a
   container image, add a host, or change a power setting. The PR explains the
   expected effect and whether it needs a migration window.
2. **CI checks both hosts.** Run `nix flake check`, build both Darwin system
   outputs on hosted Apple-silicon macOS runners, validate scripts/Compose and
   reject plaintext secrets. Pin CI actions and flake inputs. Do not activate
   configurations in CI. Hosted CI keeps recovery independent of the home runner.
3. **Merge after checks pass.** Protect main with required checks if the GitHub
   plan supports it. CI verifies the exact merged commit too, so a PR test of
   a different merge base cannot accidentally authorize an untested deployment.
4. **Each host checks approximately every ten minutes.** A root-owned updater
   fetches main using a read-only machine credential, confirms that exact SHA
   passed the required main checks, and builds that host's configuration.
   It never deploys a PR branch or refreshes dependencies outside `flake.lock`.
5. **Activate only when something changed.** Serialize runs, retain the last
   working generation and commit, decrypt secrets, then switch configuration.
   Reconcile changed services; do not restart every container every ten minutes.
   Backups and app changes share a lock. Build/download failures leave the
   currently running system alone.
6. **Check that it worked.** Confirm access and relevant service health. Track
   desired SHA, deployed SHA and last result per host. Unchanged success stays
   quiet; failures and required intervention are visible. An offline Mac catches
   up after returning online and seeing a healthy eligible revision.

This is eventual deployment, not simultaneous fleet activation. Initially
enable auto-updates on the MacBook first; the mini gets them only after migration
and recovery tests. Changes involving data moves, SSH/Tailscale replacement,
destructive cleanup or database migrations use explicit maintenance steps.

## What happens when you change the app

1. Merge an app PR into `world-wide-webb`.
2. Its CI tests the exact revision, builds the ARM64 image and publishes it to
   GHCR with an immutable digest.
3. A narrowly scoped GitHub App opens a **homelab promotion PR** updating the
   app image digest. The PR links the source commit, app CI and migration notes.
   A digest identifies an exact image; `latest` does not.
4. Homelab CI checks the proposed deployment. Merge the promotion PR when ready.
5. The assigned service host's next successful update deploys it and checks the reported app
   build SHA, database health and worker status.

Initially that is two deliberate merges: ship an image, then deploy it. Later,
routine promotion PRs can auto-merge after checks; schema-changing releases
still need explicit compatibility/backup review. If app CI fails, no promotion
is opened. If deployment fails, the existing working release remains or is
restored where safe. Publishing an image alone never changes production.

Keep the current working world-wide-webb deploy path until the replacement is
validated. At cutover turn off its direct SSH deployment, leaving image
publishing and promotion creation. Infrastructure changes do not require an app
release, and app changes do not require rewriting host configuration.

## First setup and adding another Mac

Complete macOS Setup Assistant with the host-specific administrator (`admin` on
the MacBook, `calum` on the mini), network access and required Apple
components. Run the reviewed bootstrap script locally. It installs Determinate
Nix, places the host age key from 1Password with root-only permissions, obtains
initial read access to the private repo and activates the selected host recipe.
Use Determinate's supported nix-darwin integration so two components do not try
to manage the Nix daemon simultaneously.

The private repository creates a bootstrap dependency: the host cannot fetch
its encrypted configuration without GitHub read access. Document this separate
initial credential explicitly. The requested `github:0x63616c/homelab#<host>`
command works only with appropriate Nix GitHub authentication. Subsequent pulls
can use a local checkout with a read-only deploy key; API check verification
also needs appropriately limited credentials. No token goes in command logs.

After activation, services run as `_containers` and `_runner` with fixed,
collision-checked UID/GIDs. The human account receives only basic configuration.
Root handles tasks that require it, such as Tailscale, updates and networking.
Calum has approved retirement of the testing-only `vov` staging services and
admin account. They will not migrate to the MacBook or appear in the rebuilt
mini configuration. Remove only their owned resources during the migration;
check shared dependencies first. No deletion has occurred during planning.

Adding a host means adding `hosts/<name>.nix` and its flake entry, creating a
host age key, adding its public recipient and secrets, reviewing CI, then
bootstrapping locally. No plaintext keys are committed. Key rotation grants the
new recipient access, verifies deployment, removes the old recipient and
re-encrypts; compromised service credentials themselves must also be rotated.

GitHub runner registration tokens expire after one hour. A token encrypted in
Git is acceptable for a planned first registration, but not durable unattended
recovery. Prefer a narrowly scoped GitHub App that obtains fresh registration
tokens when needed; store its credential with SOPS outside the job VM. Persist
controller bookkeeping and exported logs, not a reusable job-runner identity:
each disposable guest registers for one job and its credentials disappear with
that guest. A personal account uses repo runners unless an organization is
selected. Jobs never receive host sudo or host deployment/age credentials.
Guest administrator privileges, if required by a build, stay inside the disposable
VM. Use hosted CI for untrusted PRs and validate headless signing/keychain needs
separately. Export logs before guest disposal, and recover interrupted cleanup
after a controller/host restart without accidentally opening a second job slot.

## Recovery in plain terms

For a bad configuration or compatible app release, revert the homelab commit.
That creates a new forward-moving revision selecting the previous recipe/image.
The updater applies it normally. Retain a local manual rollback command and
working LAN OpenSSH access for when the updater or Tailscale itself is broken.

On failed activation, record the failure, attempt only the known-safe rollback,
and pause further automatic activation of that failed revision. Preserve
diagnostics. Activation scripts, Brew cleanup and data changes are not atomic;
do not promise Nix can undo them all. For an incompatible database migration,
stop writers and follow the backup/restore runbook, with explicit acceptance of
any data-loss window. A reboot/power-loss test and isolated restore test are
required before calling the system unattended.

## Order of work: move out, rebuild, selectively move back

1. **Finish the migration inventory and create the implementation PR.** Confirm
   the new MacBook's SSD, macOS and network identity; identify data and dependencies
   for every retained service. Retire vov as approved. Include both host recipes,
   CI, bootstrap, secrets, recovery and per-service migration instructions.
2. **Bootstrap the clean MacBook.** Prove users, secrets, access, headless startup
   and recovery. Do not enable general CI jobs while establishing production.
3. **Move retained services from mini to MacBook one at a time.** Rehearse restores
   using isolated copies with outbound automations disabled. At each cutover,
   pause deploys/backups, stop the old writer, take the final consistent backup,
   restore on the MacBook, switch routing, and verify. Keep source state intact.
   Preserve HA's bridged networking and Bambuddy's slicer and tailnet identity.
   Never run cloned HA automations, duplicate app workers or duplicate Tailscale
   identities on both hosts. Host Tailscale identities remain distinct.
4. **Prove the MacBook can run the home alone.** Disable the old deploy paths and
   services; power the mini off temporarily. Test real app use, printer/slicing,
   HA automations/discovery, Hindsight, public/private access and NAS backups.
   Reboot the MacBook, verify startup without login and perform an isolated
   restore. Keep it stable through at least one scheduled backup cycle. Keep
   heavy CI off until this is complete. If reverting after new writes, migrate
   fresh data back; do not simply restart the stale mini copy.
5. **Erase and rebuild the mini.** Only after those checks and verified off-host
   backups, account for everything else on its disk that Calum wants retained.
   Erasure is a deliberate maintenance step, never a PR-triggered activation.
   Bootstrap the same Nix system on the clean Mac. There is no need to import the
   old collection of packages, accounts or launchd files.
6. **Choose the final service placement.** Use observed CPU, memory and storage,
   then move selected services back using the same backup/cutover procedure.
   HA and other stable home services are good mini candidates. The 32 GB MacBook
   is the preferred runner host. Do not commit to a mini runner until it has
   measured spare capacity. The home can stay on the MacBook as long as needed.
7. **Enable steady-state updates and CI.** Each rebuilt host converges on its
   assigned services. Add isolated runners, test an image promotion and rollback,
   and finish operational ownership transfer from world-wide-webb. Keep recovery
   backups; routine Nix activation never deletes service data.

Service definitions must be reusable across hosts. Host files assign services
and resources; they do not contain duplicate service implementations. Moving a
service is a planned data and routing transfer followed by a host-assignment
change. A single merge switching enable flags is unsafe: independent ten-minute
pollers cannot guarantee stop-before-start ordering across machines.

### Evidence required before erasing the mini

Keep a migration record with the deployed commit/image, source and destination
data paths, backup identifiers, cutover time and verification result per service.
The mini is ready to erase only when all of the following are demonstrated:

- Every retained service and miscellaneous job has moved or has an explicit
  retirement decision. Unclassified jobs and personal files are not disposable
  merely because the main containers work.
- Control Center serves the expected build with its database, media and a single
  set of workers. HA retains its configuration and integrations, and its actual
  devices/automations work. Bambuddy retains printer/archive data and slicing
  works. Hindsight retains its database and required authentication/provider state.
- Public tunnel routes and private access work while the mini is powered off;
  no service relies on its DNS, proxy, exit-node routing, mounts or credentials.
- The MacBook reboots into working services without a GUI login. Its intended
  AC/lid configuration is tested. Confirm the FileVault/unattended-reboot policy
  rather than assuming a launch daemon can run before the disk is unlocked.
- At least one scheduled backup completes from the MacBook, is verified on the
  NAS, and an isolated restore proves the recovery procedure. Required age keys
  and recovery credentials remain accessible independently of either Mac.
- Automatic deploys and backups cannot restart old writers on the mini.
  Recovery instructions cover new writes made after cutover; retained old disks
  alone are not a current backup or a safe automatic rollback.

Present this evidence and any remaining exceptions before the separately
authorized erase step. This checklist is a completion criterion, not permission
to deploy or erase during planning.

## Runner isolation and resource recommendation

**Use one disposable VM per CI job, initially one job at a time on the MacBook.**
The `_runner` host account owns VM lifecycle operations; the GitHub job itself
executes inside the guest. This supersedes the earlier bare-host runner proposal.
GitHub's ephemeral registration mode alone is insufficient: discard the guest's
writable disk after the job as well. Retain logs/artifacts outside the guest.

### Tools considered

- **GitHub-hosted runners:** best default for public/untrusted PRs, ordinary
  Linux jobs and x86_64 builds. They consume no home RAM/SSD and keep these jobs
  outside the home network. Keep homelab's own CI hosted for recovery independence.
- **Tart:** preferred candidate for local macOS CI and potentially Linux ARM64
  CI using the same VM tooling. It supports both guest OSes on Apple silicon.
  Clone a maintained template per job, register a one-job runner in the guest,
  then destroy it. Tart manages VMs; it is not itself a GitHub job scheduler.
  A small trusted lifecycle controller is still required and must never execute
  PR-controlled scripts on the host. Validate cold boot/keychain behavior first.
- **Lima:** sensible Linux-only alternative, already underneath Colima. Use an
  independent disposable VM with explicit empty host mounts and no agent
  forwarding. Consider this if its Linux provisioning is materially simpler;
  do not add a second CI VM manager without a demonstrated benefit.
- **Colima/Docker runner containers:** keep Colima for production services. A
  runner container sharing production Docker is not the isolation we want;
  containers share their VM kernel, and a production Docker socket grants
  control of production containers and their mounted data.
- **Actions Runner Controller:** good for an existing Kubernetes fleet, but
  introducing Kubernetes here adds an orchestration layer we do not need for
  one or two job slots. Not recommended for this setup.

This is a documentation-based recommendation, not a benchmark or completed
security validation. Exact Tart version, lifecycle controller, network policy
and available guest images must be proven in the implementation prototype.

### Start small and measure

During migration, run home services first and defer local CI. Afterwards start
with **one total local job slot**, choosing either a macOS VM or a Linux VM.
Provisional guest budgets are 4 vCPUs/8–12 GiB for macOS builds, or 2–4 vCPUs/
4–6 GiB for Linux builds. These are starting allocations, not measured needs.
Leave headroom for macOS and any retained production services. Enforce the single
slot across repositories and both guest OS types in the lifecycle controller;
per-repository GitHub concurrency settings alone do not enforce a fleet limit.
Additional jobs queue. Do not automatically increase concurrency when memory
looks available. Any increase is a later reviewed configuration change after
measuring memory pressure, CPU, storage and real build throughput. Retain the
requested hard cap of two macOS guests as an additional future constraint.

The mini has no runner in the initial configuration. After rebuilding it, a
small Linux runner could be considered if home services leave measured room;
it would share the one-job fleet budget unless that policy is explicitly changed.
Do not plan macOS/Xcode CI alongside production on the 8 GB mini.

Both Macs are M2. Do not design around nested virtualization: run Linux/Docker
jobs directly in the Linux guest, not a Linux VM inside a macOS runner VM.
Local Linux runners are ARM64; route x86_64-required jobs to hosted x86_64 runners
by default. Emulated builds can be an explicit exception, not assumed equivalent.

Keep one current base image per guest OS, and a previous version only when disk
allows. Do not preinstall Xcode/simulators in a runner that only builds Nix.
Where the selected Tart version supports efficient cloning, reuse a read-only
base with disposable job changes; measure actual allocated bytes and allow for
worst-case guest writes. Avoid keeping a full VM for every repository. Bound
build caches, log retention and unused image retention. Keep production data
and backups outside all CI prune paths. Refuse a new job before it can consume
space reserved for the host and production. Set the threshold after measuring
SSD size, image sizes and job growth; the MacBook has approximately 500 GB storage, with free space still to verify.

Calum confirmed approximately **500 GB storage**. Measure available space before
migration and account for production data, macOS, Nix generations, VM templates,
temporary builds and image-update overlap. Keep the single-runner policy and
NAS recovery copies independent of this disk. Repository work is authorized;
bootstrap, deployment, vov removal and mini erasure are not part of this PR task.

### Expected startup time

With the template cached and tools already installed, budget approximately
**30–90 seconds for a macOS runner** or **15–60 seconds for a Linux runner**
from launching the provisioning operation to readiness for a GitHub job.
These are provisional planning estimates, not measured performance or promises.
Queue detection/polling, GitHub dispatch and job dependency downloads add time.

The first image pull is separate and may take minutes or longer depending on
image size and bandwidth. Preinstall only the required tools in maintained
templates. Shut down and discard each job VM afterwards; do not keep an idle
prebooted spare in the initial design. A clean warm spare is a later latency
optimization with an ongoing RAM cost, not a requirement for isolation.

Before setting expectations, benchmark repeated clone-to-runner-ready cycles
on the MacBook, including a host reboot and a run while production services
are active. Record typical and slow-case readiness, actual disk growth and
representative build duration. More concurrent VMs do not necessarily produce
more completed builds per hour on the same CPU and SSD.

Evidence: a [Tart issue](https://github.com/openai/tart/issues/903) reports
roughly 15-second boots on some machines and over 45 seconds on another;
that is anecdotal boot timing, not an end-to-end runner benchmark. The
[quick start](https://tart.run/quick-start/) illustrates the separate large
initial image download. Linux readiness estimates still require local testing.

### Isolation includes the network

No host-home mounts, production Docker sockets, SSH-agent forwarding, age keys,
1Password access, production credentials or broad tailnet credentials in guests.
The controller's GitHub App credential stays outside the guest; inject only a
short-lived registration credential and minimal job credentials. Each guest is
recreated, not reused between jobs or repositories. Cache access is scoped by
repository/trust level so untrusted jobs cannot poison release caches.

Default NAT is not sufficient: a VM can still reach LAN services through it.
Use a supported VM networking policy (Tart Softnet is a candidate) with explicit
host/LAN/tailnet/IPv6 restrictions and narrow exceptions for DNS and required
internet access. Test those restrictions from the guest before enabling CI.
A future UniFi CI VLAN can isolate a dedicated runner host, but cannot separate
NATed guest traffic from production on that same host by itself. Avoid granting
CI broad access merely to deploy; hosts pull approved releases themselves.

VM isolation reduces risk; it is not a guarantee against hypervisor bugs or
resource exhaustion. The best eventual boundary is home services on the mini,
CI on the MacBook, plus disposable guests and restricted networking. While
production and CI share the MacBook, allow only trusted jobs and tighter limits.

## Technical references checked

Read-only implementation preflight confirmed three Darwin-specific details:

- sops-nix installs secrets during post-activation and through a separate boot
  daemon. A dependent service must wait for readable secret files with bounded
  retry; merely setting both jobs to RunAtLoad does not establish ordering.
  Secret updates also need explicit service reload/restart handling.
- The inspected nix-darwin user module has no active `extraGroups` user option.
  Declare primary groups explicitly, verify fixed IDs, and check actual admin
  membership rather than copying NixOS account options into a Darwin module.
- Darwin OpenSSH uses `services.openssh.extraConfig` and Apple's server. Verify
  the effective configuration on each host: earlier SSH drop-ins can take
  precedence, so the generated file alone is not proof of key-only access.

The authoring computer has `gh` but no `nix` executable on PATH. Plan to obtain
actual Darwin build evidence through the CI workflow or an explicitly prepared
validation environment; text inspection cannot substitute for a successful build.
The authenticated lookup of `0x63616c/homelab` returned 404 in this preflight;
verify availability before creation rather than assuming a remote exists.

- [Tailscale SSH platform support](https://tailscale.com/docs/features/tailscale-ssh):
  macOS server support requires the open-source CLI/daemon variant.
- [nix-darwin Tailscale module](https://github.com/nix-darwin/nix-darwin/blob/master/modules/services/tailscale.nix):
  installs the daemon; auth-key enrollment and Serve reconciliation need explicit
  implementation rather than assumed NixOS-only options.
- [sops-nix flake](https://github.com/Mic92/sops-nix/blob/master/flake.nix):
  current upstream exports a native Darwin module.
- [Darwin secrets implementation](https://github.com/Mic92/sops-nix/blob/master/modules/nix-darwin/default.nix),
  [user options](https://github.com/nix-darwin/nix-darwin/blob/master/modules/users/user.nix),
  and [OpenSSH module](https://github.com/nix-darwin/nix-darwin/blob/master/modules/services/openssh.nix)
  were inspected directly for the preflight findings above.
- [nix-homebrew](https://github.com/zhaofengli/nix-homebrew): Homebrew installation
  management, alongside nix-darwin package declarations.
- [Determinate integration](https://github.com/DeterminateSystems/determinate):
  use its current Darwin module and configuration ownership model.
- [Colima commands](https://colima.run/docs/commands/): VZ/Rosetta support.
- [GitHub runner API](https://docs.github.com/en/rest/actions/self-hosted-runners):
  registration token expiry and fresh registration flow.

Runner research sources:

- [GitHub runner guidance](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
  recommends ephemeral runners; registration and VM disposal are separate concerns.
- [Tart](https://tart.run/) supports macOS and Linux guests.
- [Tart FAQ](https://tart.run/faq/) documents headless keychain requirements,
  M2 nested-virtualization limitations and stronger host separation with Softnet.
- [Tart current FAQ source](https://github.com/openai/tart/blob/main/docs/faq.md)
  describes newer disk overlay features; do not assume these exist on the chosen
  host OS/version. Validate before using them for capacity estimates.
- [Lima security](https://lima-vm.io/docs/security/) and
  [networking](https://lima-vm.io/docs/config/network/) describe the alternative.
- [ARC](https://github.com/actions/actions-runner-controller) is Kubernetes-based.
