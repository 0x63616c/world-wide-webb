# Current state

Source consolidation is complete: both Macs and CLI delivery use WWW. Old-repository links
below are historical observations. See the [migration record](../../docs/plans/monorepo-migration-progress.md)
for current ownership; inspect live host state before operations.

## Restart incident — November 11, 2026

After the owner restarted and logged into the rebuilt Mini, host Tailscale and SSH
were available at `admin@homelab-mac-mini.tail8c014d.ts.net`, but Bambuddy was offline
and localhost ports 8000/4202 refused connections. Host uptime was approximately
32 minutes. Comin recorded installed WWW source
`80e3328b53408ee1718ae3e9e054a1b6e607ac12` from `deploy/homelab`.

The services VM hostagent reported VZ running, but its serial log was empty and
guest SSH never became available. The Colima launchd job had retried 46 times;
`colima list` still reported Running. Home Assistant's independent VM and container
had started successfully. This establishes a stalled services-guest boot; the
underlying VZ/EFI cause remains unconfirmed.

Recovery unloaded only `org.nixos.homelab-colima`, ran `colima stop services --force`
as `_containers`, then reloaded the existing launchd plist. The guest booted and
existing containers restarted automatically. No VM disks, volumes, identities,
maintenance holds or launchd definitions were replaced. Bambuddy, Control Center,
Penpot and HA returned HTTP 200; the private Control Center HTTPS health route also
returned 200 and Bambuddy's Tailscale node returned online.

The assigned-service health command also passed after recovery. Repeated
`colima start` calls did not recover the guest marked Running while unable to boot.
The startup supervisor now waits up to three minutes for Docker, then rechecks
Docker and guest SSH under the shared operation lock. An unreachable guest is
stopped without replacing disks, allowing launchd to retry its declared start.
A responsive guest is left running; active operations, interrupted transactions
and maintenance holds defer recovery. Startup/recovery diagnostics are retained
in `/var/lib/_containers/colima-startup.log`. Focused tests cover the observed failure and
these recovery protections. The supervisor also forwards shutdown signals to
foreground Colima and reaps it, preserving graceful VM stop during a restart.
A real-process regression covers this lifecycle. All 173 homelab tests (one existing skip) and 31
handler tests pass. An isolated real-process fixture on the Mini's installed Nix
Python/coreutils also passed the stale-Running recovery and verified the stop
subprocess retained the operation lock. Live installation and reboot acceptance
are recorded in the live delivery receipt.

### Home Assistant bridge after the first unattended restart

The startup/signal fix reached checked WWW source
`eb6e0b18209fc859d014526e3cb2a0cd0c4714bb`. Its first unattended restart brought back
Bambuddy, Control Center and Penpot; the private app responded before post-boot SSH.
HA's container was healthy and had the correct static address, but the bridged LAN
was unreachable and guest ARP resolution failed even for the gateway. Restarting
its bridge and existing guest after the physical LAN was ready restored LAN HTTP200.

The bridge and HA guest launchers now wait for the configured physical interface to
have an active link and usable IPv4 address. They share the same helper dependency,
so a readiness change also replaces the guest's connection to the bridge backend.
The wait fails after two minutes and launchd retries; it does not choose another
interface or change the guest's address/identity. Root bridge diagnostics live in
`/var/log/homelab-ha-vmnet.log`. A cold-network fixture, link-local rejection and
bounded-failure test cover the readiness gate. The live delivery receipt records
the final unattended restart result.

The deployment also encountered an uncached private Control Center image. An
existing operator credential populated that exact image through Docker's local API
under the shared operation lock; no registry credential file was retained on the
Mini. Future uncached private images still require a scoped pull credential or an
approved operator cache fill. Reboot uses the retained local images.

## Read-only refresh — November 8, 2026

Live SSH inspection used the existing trusted names `calum@homelab` and
`admin@homelab-macbook.local`. No host/service changes or backups/restores were
performed, and no credentials were retrieved. Root-only mini inspection remains
unavailable through noninteractive sudo. The November 3 snapshot below is
historical; use this refresh for the observed changes and the refreshed
[migration plan](plan.md) for the proposed sequence.

- Mini: hostname `homelab.local`, macOS 15.6, 8 GB per prior hardware census;
  data filesystem 228 GiB, 178 GiB used, approximately 26 GiB available.
- MacBook: enrolled `homelab-macbook`, macOS 27.2, live sysctl confirms 32 GiB
  RAM; data filesystem 460 GiB, 260 GiB used, approximately 172 GiB available.
  `/run/current-system` exists; Comin and the homelab runner plist are installed.
  Observed revision was `042feacdde382c5b9cc07341353a80b0c3772408`; another
  chat is actively updating runner configuration, so recheck before changes.
- Control Center is healthy on localhost:4202, running image digest
  `sha256:b99bced2cd96c21b225e2017c1b296651b2c820690d7b983c7257a6b88410f59`.
  `/app/data` is local named volume `www-control-center-sqlite`; media and
  secrets are bind mounts. Its effective Compose label points into
  `~/www-control-center/candidate.gcYkFn/compose.yaml`. Old PostgreSQL is stopped.
  Existing homelab recipes still describe PostgreSQL and must be refreshed.
- Penpot 2.18.6 has seven running containers: backend, frontend, admin console,
  exporter, PostgreSQL 15.15, MCP and Valkey 8.1.4. Frontend localhost:9001
  responds 200. `penpot_assets`, `penpot_postgres` and Valkey's anonymous `/data`
  volume are retained state. Effective Compose labels reference both
  `~/penpot/compose.yaml` and `~/penpot/bootstrap.yaml`; a separate MCP nginx
  template is mounted. Penpot has its own 05:15 backup agent and dated local
  backup directories; NAS recovery/restore was not independently tested here.
- Bambuddy, its separate Tailscale sidecar and amd64 studio API are running;
  app health responds 200. Preserve app/studio/log and identity volumes.
- Hindsight 1.0.0 remains running with local bind-mounted `data` and `codex-home`
  (combined directory approximately 1.9 GiB), exposed on 8888/9999. Its container
  has no explicit memory limit; placement needs measurement.
- HA is healthy in the separate running `colima-ha` daemon, using `ha_config`
  and the existing pinned image. LAN HTTP at 192.168.0.130:8123 responds 200.
  Created migration inspection containers and an exited seed container remain;
  do not infer these are active services or delete their storage by inference.
- Cloudflared runs the pinned tunnel image; a newer user watchdog is scheduled
  every 30 seconds. Host Tailscale Serve now also sends its HTTPS root to 4202,
  alongside 8000 and 10350. External route inventory still needs refreshing.
- Loaded custom agents include HA startup, Hindsight health/backup, nightly
  homelab backup, hourly Control Center backup, Penpot backup, tunnel recovery,
  firstmate/herdr, sccache, cargo cleanup and zero/sampler. Zero reports exit 1.
  System launchd still lists vov colima/stack/updater; protected state was not
  inspected. Portal forwarding is listed with exit 1. Retained Multica is stopped.
- Nightly backup is scheduled 04:15. Latest observed full-set success in its log
  is November 7 (`20261107T121505Z`) with COMPLETE/NAS_VERIFIED present; this
  does not establish a current successful restore or November 8 nightly success.
  Hourly Control Center logs report verified SQLite/photo snapshots through
  `20261108T120004Z` (04:00 local). Script inspection confirms SQLite snapshot
  support and separate NAS upload markers. Penpot's script uses PostgreSQL
  custom-format dumps. All replacement paths need actual downloaded restores.
- OrbStack Docker reports 70 images (~22.97 GB), 11 volumes (~1.059 GB), and
  ~3.174 GB build cache. This excludes HA/vov daemons and host bind mounts.
  `~/www-control-center/data` is ~1.3 GiB and `~/homelab-backups` ~6.1 GiB.
  Do not sum these into a claimed full disk/migration budget.

The newer runner worktree declares one 4-vCPU/8-GiB guest, 140 GiB admission
free-space requirement and 80 GiB emergency floor. It also still contains the
old Control Center recipe. Local working changes in this checkout were left
untouched. Remaining uncertainty includes privileged vov/process inventory,
miscellaneous job disposition, current network reservations/public routes,
all-service recovery, full state sizing and final 8-GiB-mini capacity.

Research snapshot: November 3, 2026, America/Los_Angeles. No host, service,
router, or repository settings were changed. This document distinguishes live
observations from repository documentation and information supplied by Calum.
It contains no secret values. After this read-only research, Calum authorized
the private [homelab repository](https://github.com/0x63616c/homelab) and
[draft implementation PR](https://github.com/0x63616c/homelab/pull/1), without
deployment. This inventory remains evidence of the existing live system, not
a claim that the proposed Nix setup has been applied.

## Sources and freshness

- Live read-only SSH as `calum` to `homelab`, using the existing SSH connection.
  This is OpenSSH over the tailnet, not proof of a Tailscale SSH server.
- Live UniFi web UI at `192.168.0.1`, using the existing saved login. Viewed
  dashboard, clients, networks, main DHCP settings, and policy table.
- GitHub `0x63616c/world-wide-webb` main:
  `3368a603cd162caac37e558f4fe88bcafe115b37`, checked through the GitHub API.
  The mini's source checkout is older: `0f1584ce3090a3a25e830373dde905d79b21abf6`.
  Findings use current GitHub source, not that checkout.
- GitHub `0x63616c/bambuddy-homelab` main and mini checkout both:
  `2884b8f8239d3680e2255371fd35eea525c3c951`. Checkout reported no changes.
- Discovered staging repo `Virtual-Outfit-Vault/vov`: GitHub main and installed
  checkout both `17e5b9f96b0951c0939c692d92c8b34b71ba766f`. The connector could
  not access this repo; authenticated `gh api` supplied the current revision.

Relevant current source:

- [world-wide-webb README](https://github.com/0x63616c/world-wide-webb/blob/3368a603cd162caac37e558f4fe88bcafe115b37/README.md)
- [Mini Compose](https://github.com/0x63616c/world-wide-webb/blob/3368a603cd162caac37e558f4fe88bcafe115b37/deploy/mini/compose.yaml)
- [Migration history](https://github.com/0x63616c/world-wide-webb/blob/3368a603cd162caac37e558f4fe88bcafe115b37/docs/runbooks/mac-mini-migration.md)
- [Backup runbook](https://github.com/0x63616c/world-wide-webb/blob/3368a603cd162caac37e558f4fe88bcafe115b37/docs/runbooks/mini-backups.md)
- [Bambuddy Compose](https://github.com/0x63616c/bambuddy-homelab/blob/2884b8f8239d3680e2255371fd35eea525c3c951/docker-compose.yml)

## Machines and accounts

The mini is an Apple M2 Mac14,3 with 8 GB RAM, macOS 15.6 (24G84), and a
roughly 228 GiB APFS system container. Data volume usage is 157 GiB with about
47 GiB available. Hostname reports `Mac.localdomain`; tailnet name is `homelab`.
Proposed future name: `homelab-mac-mini`.

`calum` is UID 501, primary group staff/20, and an administrator. `vov` is UID
502, also an administrator, and owns live staging daemons. Guest UID 201 and
normal macOS system accounts also exist. `_runner` and `_containers` do not
exist. Candidate UID/GID 350/351 did not appear in the inspected inventories;
implementation must check both hosts again before reserving IDs.

FileVault is off on the mini. OpenSSH is loaded, port 22 is listening, and the
inspected SSH drop-in only sets Apple's PAM/environment/crypto defaults. A
complete effective root SSH configuration was not available. Do not claim
password login is already disabled.

The second MacBook is freshly reset according to Calum, Apple M2 with 32 GB
RAM. Proposed name: `homelab-macbook`. It was not remotely inspected; disk,
macOS version, FileVault, accounts and its mapping to existing network clients
remain unverified.

## Running service inventory

### Control Center drift observed November 3, 2026

A later read-only check over the existing SSH connection found the live Control
Center container and its image `RepoDigests` at
`ghcr.io/0x63616c/www-control-center-mini@sha256:bcd15b104035195c5e200758078eac3ea2606d7851917c77210e0e49e63e35af`.
`bun --version` inside that existing container returned `1.4.4`, and the local
`/trpc/health.buildHash` endpoint returned
`61681a864484c1e2c466a9b4bdcdfefbaadebf93`. The GitHub Dockerfile at that revision
uses `oven/bun:1.4-alpine`; this describes that source and the observed runtime,
not the older pinned image.

The declared release remains digest
`sha256:7c039963a2d94132d2cae54e5000f24fb1dceb683a685cc7e109ef5bb224afe8`
with source revision `38afee6c84fcf48c0edb2466aa4b27d287a59c30`. That image is
still cached on the mini, and its revision label matches the declaration.
However, querying that revision through the GitHub tree API returned HTTP 422
(invalid commit/tree), so its source and exact Bun version were not independently
verified. No old container was started. The earlier inventory below is a dated
baseline and does not establish the current Control Center runtime.

The existing `world-wide-webb` deployment still owns the live service. Refreshing
the declared release and transferring deployment ownership require an explicit
reviewed cutover; this observation did not change images, pins, or services.

### OrbStack under calum

OrbStack 2.0.5 is the active Docker context, with socket
`/Users/calum/.orbstack/run/docker.sock`. Docker CLI is 29.8.1 and Compose 5.5.1.

- **Control Center**: `www-control-center-www-1`, published on
  `127.0.0.1:4201`. Live image is
  `ghcr.io/0x63616c/www-control-center-mini@sha256:1183f56840763f526c02b97816e1da97f1973358857f0b533b7daaa9fd342f66`.
  Release filename references current GitHub revision `3368a603…`.
  Compose is `~/www-control-center/compose.yaml`; media and secret files are
  bind-mounted from that directory. `/healthz` returned HTTP 200.
- **Control Center PostgreSQL**: separate container, private Docker port 5432,
  bind-mounted `~/www-control-center/data/postgres`, password read from a file.
  Current source specifies PostgreSQL 18 and a pinned digest. Database name
  is `control_center`. App worker cycles run inside the www process.
- **Cloudflare tunnel**: `www-tunnel-cloudflared-1`, pinned image digest,
  Compose `~/www-tunnel/compose.yaml`, token file mounted read-only. Current
  repository documentation identifies origins `127.0.0.1:4201`,
  `192.168.0.130:8123`, and `192.168.0.218:5001` for app, HA and DSM.
- **Bambuddy**: Compose `~/bambuddy/docker-compose.yml`, image
  `ghcr.io/maziggy/bambuddy:latest`, `127.0.0.1:8000`, healthy.
  Named volumes: `bambuddy_bambuddy_data` and `bambuddy_bambuddy_logs`.
  Its health endpoint returned HTTP 200. Printer credentials live in app data.
- **Bambuddy Tailscale sidecar**: `tailscale/tailscale:stable`, userspace mode,
  its own identity `bambuddy`, `tag:server`, persisted in
  `bambuddy_tailscale_state`. Serve configuration is a read-only file mount;
  current GitHub configuration prohibits Funnel. Keep this identity on migration.
- **Bambu Studio API**: `ghcr.io/maziggy/bambu-studio-api:latest`, explicitly
  `linux/amd64`, internal port 3000, healthy; uses OrbStack Rosetta. State is
  `bambuddy_bambu_studio_api_data`. This must be included in any Colima move.
- **Hindsight**: `ghcr.io/vectorize-io/hindsight:1.0.0`, published on all host
  interfaces at ports 8888 and 9999. No Compose labels: started with scripts
  under `~/hindsight`. Bind mounts are `data` to `/home/hindsight/.pg0` and
  `codex-home` to `/home/hindsight/.codex-hindsight`. HTTP health returned 200.
  Runtime has provider/model settings and several API/auth credentials; only
  environment key names were inspected. Preserve both data and codex-home.
- **Multica Postgres**: `pgvector/pgvector:pg17`, stopped for six weeks,
  retained `multica_pgdata` volume. Do not reactivate or delete by inference.

### Home Assistant: already production

HA is a container inside the separate `colima-ha` VM, not HA OS. Colima 0.10.3,
Lima 2.2.0; VM is aarch64, VZ, 2 CPUs, 2 GiB RAM and 12 GiB disk. It bridges
through `en1` using root `socket_vmnet`. VM port forwarding is disabled.

Compose is `~/home-assistant/compose.yaml`, project `www-home-assistant`.
Image is pinned to
`ghcr.io/home-assistant/home-assistant@sha256:5a531753cea96444200158fc2b0ac7ccd739291ec50414877b396de6e0bb29b3`.
HA uses VM host networking, external volume `ha_config`, and a 1 GiB memory
limit. Its entrypoint waits for interface `ha0` and the correct default route
before starting HA; this is intentional LAN-discovery behavior to preserve.
`http://192.168.0.130:8123/` returned HTTP 200. The current runbook calls this
address reserved; the reservation itself has not yet been verified in UniFi.

Replacing this with HA OS is a separate migration, not a disabled-stub addition.

### Other active or retained jobs

System launchd files include:

- `com.virtualoutfitvault.staging.{colima,stack,updater}` under `vov`.
  Colima and stack are running; updater interval is 60 seconds. Source lives
  under `/Users/vov/vov-staging/infra/staging`. Its Docker socket denied access
  to calum, so its containers and data have not been fully inventoried.
- `homebrew.mxcl.socket_vmnet`, root bridged networking on `en1`.
- OrbStack privileged helper.
- `com.calum.portal-443-forward`, enabled but observed last exit code 1.

Loaded calum jobs include HA startup, Hindsight health checks (900 seconds),
Hindsight backups, homelab backups, cargo cleanup, firstmate/herdr remote jobs,
sccache, and zero/zero sampler. `zero` showed exit code 1. These observations
are not diagnoses or authorization to remove jobs.

Five retained GitHub runner plist definitions cover AgentInc, Apps, Fries and
two Voxelite runners. All five are disabled and absent from loaded job output.
Current world-wide-webb runbook records their retirement and some GitHub
deregistrations. They must not be automatically re-enabled on the mini.

Signal CLI, Signal tunnel, UniFi proxy, and OrbStack watchdog plist files also
exist but are disabled according to live launchctl state. This differs from
older runbook statements about retaining an active watchdog; live state wins.
Do not equate the presence of a plist with a running service.

## Packages, storage and power

Homebrew direct formula leaves observed:

```text
aria2 chezmoi colima docker docker-compose gh ghq goenv htop just libyaml
mole multica-ai/tap/multica neovim ngspice node poppler python@3.12 qemu
sccache sevenzip signal-cli socat socket_vmnet tilt tmux unar xcodegen zig
```

Casks: codex 0.160.1, octarine 0.31.1, orbstack 2.0.5. The full installed
package/version census was read, including dependencies. The list above is
the candidate declaration inventory, not a recommendation to remove anything
else immediately. `cleanup = "zap"` needs a completed ownership review first.

Selected directory sizes: Hindsight 1.1 GiB; Bambuddy source 14 MiB (excludes
Docker volumes); Control Center data 862 MiB; homelab backups 1.9 GiB; calum
Colima 5 GiB; actions-runners 14 GiB. OrbStack's virtual mount reports 14 GiB
used. These are overlapping views and must not be added together.

AC power: sleep 0, display sleep 0, standby 0, autorestart 1, wake-on-network
`womp` 0, disk sleep 10, powernap 1, tcpkeepalive 1. Desired change is primarily
wake-on-network; never-sleep and restart-after-failure already exist.

## Tailscale and exposure

Host Tailscale is GUI app version 1.86.4. `/usr/local/bin/tailscale` is a wrapper
to `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, not open-source
tailscaled. Host IP is `100.78.116.17`; it advertises exit-node capability.
Accept-routes is false. Existing host Serve routes are HTTPS 8000 to localhost
8000 and HTTPS 10350 to localhost 10350. Both report tailnet-only; no active
Funnel route appeared. The purpose of 10350 still needs attribution.

Tailnet peers include bambuddy `100.72.116.14`, macbook-pro `100.80.127.70`
(direct LAN endpoint `192.168.0.214`), offline macbook-m2 `100.106.103.33`,
ucg-fiber `100.89.2.18`, hometb, grokbot, home-server and personal mobile peers.
These names do not establish which MacBook is the newly reset runner machine.

Host netstat listeners included all-interface ports 22, 53, 88, 1025, 3000,
3031, 3283, 4000, 4318, 4321, 4566, 5173, 5432, 5900, 8025, 8081, 8888 and
9999, plus dynamic high ports. Loopback listeners included 4201, 8000, 10350,
4227, 8021, 18554, 20241 and OrbStack/VM dynamic ports. Hindsight and observed
OrbStack bindings were attributed; remaining listeners require privileged
process attribution. A listener is not proof of internet reachability.

Noninteractive sudo is unavailable. Root-only process inspection and effective
SSH authentication verification remain incomplete. No password prompt was used.

## Home network: world-wide-webb

Live controller: UCG Fiber, UniFi OS 5.1.34, Network 10.6.109, gateway
`192.168.0.1`. AP: `U7 Pro XGS - Living Room`. The client view showed 25 online
and 5 offline clients in its selected history window, 23 on world-wide-webb.

- `main`: VLAN 1, `192.168.0.0/24`, DHCP `.6`–`.254`, 86400-second leases,
  automatic gateway and DNS, domain `localdomain`, IPv6 interface disabled.
- `guest`: VLAN 20, `192.168.20.0/24`, DHCP server. Full guest settings were
  not opened. Global security posture displays Allow All; this alone does not
  establish effective guest isolation/firewall behavior.
- Gateway mDNS proxy Auto; IGMP snooping off in the viewed global settings.
- Policy table shows **zero configured Port Forwarding rules**, two masquerade
  NAT rules and two policy routes: NordVPN for main, plus Apple `17.0.0.0/8`
  bypass via AT&T. Enabled/disabled status of each route was not established.
  Dynamic UPnP mappings and upstream ISP equipment were not audited.
- Two local DNS A records: `captive-portal.worldwidewebb.co` resolves to
  `192.168.0.3`; `nas.worldwidewebb.co` to `192.168.0.218`, verified by querying
  the gateway. The mini uses router DNS plus Tailscale MagicDNS `100.100.100.100`.

Known addresses and confidence:

- Mini: `192.168.0.147`, DHCP ACK on `en1`; reservation unverified.
- Bambu P2S: `192.168.0.94`, supplied by Calum, current Bambuddy docs and live
  ARP agree. UniFi identifies the named client P2S 3D Printer; reservation unverified.
- HA VM: `192.168.0.130`, live HTTP and ARP; reservation asserted by current
  deployment docs, not independently checked in controller settings.
- NAS: `192.168.0.218`, DNS and ARP; UniFi client NAS - HomeTB on gateway port 3.
- macbook-pro peer: `192.168.0.214`, direct Tailscale endpoint.
- MacBook-Pro client ending `9a:92`: ARP maps to `192.168.0.44`; UniFi name
  and matching MAC suffix support the correlation, not its ownership/role.
- Other ARP neighbors: `.23`, `.63`, `.88`, `.149`, `.152`, `.161`, `.173`,
  `.179`, `.193`, `.211`. Not all have been positively mapped to names.

UniFi client names also include HomePod, Calum's iPad, Calum's SoFi Laptop,
Calum's Macbook, Apple TV, iPhone, BLE proxy, Robodog, Ecobee, Eufy camera,
colima-ha, home-server, two Shelly devices, water fountain, Philips Hue Bridge
(gateway port 2), X-C13SG, six Sonos clients, Body-Smart and Home Assistant VM.
The UI reports six Fixed IP clients, but the individual reservation details
and complete client/IP export were not collected. Some device-type guesses
are inaccurate: trust observed hardware or owner identity over UniFi guesses.

## Backup and deployment dependencies

Current world-wide-webb main CI builds an ARM64 image and deploys it over the
tailnet. Existing scripts serialize deploy/recovery/backup operations and
check exact build identity, database health and worker ownership. They are
valuable behavior to port rather than replace with a bare `compose up`.

The 04:15 backup agent snapshots Control Center, HA and Bambuddy consistently,
uses Hindsight's online DB backup, and includes media, credentials and Tailscale
identity. It uploads to the encrypted Homelab NAS share with certificate
pinning and read-back hash validation. The current runbook records successful
manual tests; a scheduled invocation was not independently verified here.
No backup or restore was run during this read-only investigation.

Talos is retired and shut down according to current GitHub documentation.
Its disks/backups are retained; do not restart stale writers. The existing
51-photo recovery gap is documented upstream and is not a new migration loss.

## Remaining evidence before implementation/cutover

1. Finish fixed-IP reservations/client inventory, effective firewall/UPnP
   review and MacBook identity mapping; do not invent reservations.
2. Before retiring vov as subsequently approved, identify its owned resources
   and shared dependencies so removal does not affect retained services.
3. Attribute remaining listeners and determine which miscellaneous jobs remain
   wanted; inspect effective SSH policy with appropriate read access.
4. Record MacBook storage/macOS/security state and validate service-user
   launchd behavior on it before applying the same pattern to production.
5. Obtain real age public recipients, desired runner repository scope and
   deployment credential arrangement. No keys or encrypted placeholder files
   have been fabricated.

## Decisions after the research snapshot

Calum confirmed vov staging and its admin account were testing-only and may be
removed. They are excluded from the target system; nothing has been deleted in
this planning session. The live findings above remain a historical inventory.

Revised migration: bootstrap the M2/32 GB MacBook, migrate all retained services
there, validate it independently with the old mini off, then erase/bootstrap the
mini and selectively move services back. Final placement is not fixed. The
MacBook SSD remains unknown; a local disk check on the chat computer is not
an inventory of the reset MacBook. See plan.md for cutover and isolation gates.

Calum subsequently narrowed the possible MacBook storage to 256 GB or 512 GB,
still unconfirmed, and will verify it before work starts. The agreed initial
CI policy is one local runner job at a time across the homelab, on the MacBook,
using a disposable macOS or Linux VM. No runner is initially assigned to the
mini. Startup estimates in the plan are unmeasured planning ranges.

Latest owner confirmation: MacBook storage is approximately 500 GB and its
Setup Assistant administrator is `admin`. Repo/PR implementation is authorized,
without deployment. Exact free disk space remains to be measured.

### GitHub evidence refresh during implementation

Rechecked `world-wide-webb` main at
`a53015e758e347cc1c664e258e89c99679a43204` after the initial inventory.
The original backup/upload/release/Compose sources are unchanged from
`3368a603cd162caac37e558f4fe88bcafe115b37`; subsequent changes include app UI
and migration-runbook documentation. The updated
[mini migration runbook](https://github.com/0x63616c/world-wide-webb/blob/a53015e758e347cc1c664e258e89c99679a43204/docs/runbooks/mac-mini-migration.md)
records a UniFi HA DHCP reservation `52:55:55:6e:cd:71 → 192.168.0.130` and a
successful HA VM restart. This is evidence reported by that source, not a fresh
controller read or a Mac reboot test performed for this repository. Any HA move
must explicitly transfer the reservation/address after the old VM is stopped.

### MacBook OS confirmation

Calum reports the reset M2/32 GB/~500 GB MacBook runs macOS **27.2** and uses
the human admin account `admin`. This is owner-provided information, not a
remote OS measurement. It clears the selected Softnet release's documented
macOS 26 minimum; actual Tart/Softnet/headless compatibility still needs testing.
