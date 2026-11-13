# Home Assistant and Dreame L50 Ultra

Home Assistant Container runs in the independent `colima-ha` VM on the Mini,
with restored external Docker volume `ha_config` mounted at `/config`.
The LAN UI is <http://192.168.0.130:8123>. This is not HA OS; do not boot a
second copy of this production state. The Dreame PM20 purifier is outside this change.

## Memory and deployment

Desired sizing is 2 CPUs, **3 GiB VM RAM**, 12 GiB data disk and 8 GiB root disk.
`modules/homeassistant.nix` defines `memoryGiB`; the Mini explicitly sets 3 in
`hosts/homelab-mac-mini.nix`. `homelab.json` assigns the service, not its memory.
Compose limits HA to **2 GiB**, leaving 1 GiB inside the guest for Linux, Docker
and the short provisioning container. The Mini's separate services VM remains
4 GiB, so combined guest allocations leave only 1 GiB nominally for macOS on
this 8 GiB host. Monitor host memory pressure after deployment; repository tests
do not establish adequate capacity under real load.

Normal deployment is checked main → `deploy/homelab` promotion → Comin's
stateful activation. Memory changes alter the generated HA Colima launcher and
its deployment-input hash. The planner selects HA, requires a verified off-host
backup, and includes Control Center in post-change health. Under the existing
operation lock, `stateful-activation.py` unloads the HA launcher, gracefully stops
the guest, unloads vmnet, activates the new generation, and ensures both launchers
are loaded. The launcher copies the new Colima profile before starting the stopped
guest with 3 GiB. No manual `colima set` or VM recreation is required. Bridge
readiness, external-volume checks, interrupted-transaction holds and LAN health
remain enforced. Allow a VM stop/start and a full HA container restart; no disks,
volume identities or HA integration entries are replaced.

`homelab-reconcile-ha` invokes `scripts/provision-ha.py` under the same operation
lock before Compose `up --wait`. It inspects `ha_config`, then streams the script
and public configuration into a temporary container using the existing pinned HA
image, mounting only that volume. Nix-store paths do not need to be guest mounts.
Missing restored `configuration.yaml` fails closed. The temporary container needs
outbound HTTPS for first installation/version changes; no SSH or vault client is
involved. Regular unchanged reconciles verify managed hashes and do not download.

Provisioning checks SHA-256 before unpacking and rejects archive traversal and
symlinks. It adds marked blocks to existing `configuration.yaml`, preserving
comments, includes and unrelated settings. It reuses an existing literal
`homeassistant.packages` mapping or `!include_dir_named` directory; otherwise it
adds the named package include. Existing include-file packages, flow mappings,
conflicting dashboard/resource/module declarations, unmanaged installations of
these assets, YAML anchors, or local edits to managed files stop provisioning for operator
reconciliation. It never replaces those conflicts automatically. Preserve a private
backup, then move a conflicting asset aside or merge the intended includes locally
before retrying normal reconciliation. Never share configuration/backup contents.

Original files are backed up privately by content hash under
`/config/.homelab-vacuum-backups`; `.homelab-vacuum.json` records owned files.
A pending ownership journal allows retry after an interrupted install. Changes
leave `.homelab-vacuum-dirty` until Compose recreates HA and reports healthy.
Failures keep the marker for retry; unchanged reconciles do not restart HA.
Custom components require this full restart. The normal pre-activation backup
remains the recovery point; the private file backups do not replace it.

Asset, dashboard and package files are under `services/home-assistant/` and are
included in evaluated HA deployment inputs. The provisioning script and shared
entity list are explicitly hashed for HA; changes to them select HA without
turning provisioning into a shared all-services deployment trigger. The entity
list also selects homelab CI and Control Center's image build. Deployment changes
to the shared input-hashing module itself conservatively select the existing
safety scope for this first rollout. App image promotion remains a separate unit.

## Pinned assets

`services/home-assistant/assets.json` is the source of URLs and SHA-256 pins:

| Asset | Version | SHA-256 |
| --- | --- | --- |
| [HACS](https://github.com/hacs/integration/releases/tag/2.0.5) | 2.0.5 | `97be6b824a4f38e683728cc6dd72367f6b8bad0a43428b1b3b987a3087adf413` |
| [Dreame Vacuum](https://github.com/Tasshack/dreame-vacuum/releases/tag/v2.0.3) | v2.0.3 | `f9af5050ef47cf61c1212d29331b211873920419ecfaadb4b21b0479e45fdf57` |
| [Xiaomi Vacuum Map Card](https://github.com/PiotrMachowski/lovelace-xiaomi-vacuum-map-card/releases/tag/v2.4.1) | v2.4.1 | `6eb544c670480607c75d82321bb5d1932c781098c1f34391084ecefcac23d445` |

Dreame's tag resolves to commit
`fec086caf064f2681e8bcc7be20a0d0ef54f444d`. HACS and Dreame release zips go into
`custom_components/hacs` and `custom_components/dreame_vacuum`. The card's release
JS goes into `www/community/lovelace-xiaomi-vacuum-map-card/`. Release assets
were downloaded and hashed during authoring; deployment independently verifies
those same bytes before installation. No large binaries are committed.

To update, review the upstream stable release and compatibility notes, download
the exact release asset, compute `sha256sum`, and update its version, URL and hash
in `assets.json` together. For Dreame also resolve and record the tag's commit.
Run provisioning tests and required checks. Do not use HACS to update these three
repo-owned paths: local changes are intentionally detected as conflicts. Hashes
must change only after reviewing real downloaded bytes; no checksum bypass exists.

## One-time setup

After deployment, open **Settings → Devices & services → Add integration →
Dreame Vacuum** (Tasshack), choose **Dreamehome cloud**, region **US**, and use
the credentials in 1Password item **Dreamehome (Home Assistant)** for the account
specified by Calum. Enter credentials only in HA's UI; never put them in this
repository, environment files, scripts, screenshots or deployment diagnostics.
Select the map type in integration options and confirm the generated entities.
See [upstream configuration](https://dv.tasshack.com/configuration/dreamehome)
and [dashboard guidance](https://dreame-vacuum.tasshack.com/guide/dashboard).

HACS is installed but its **separate GitHub authorization is optional**: add HACS
in the HA UI and complete its device authorization later if desired. Direct
Dreame and card provisioning works without HACS authorization or `/hacsfiles`.

## Entity names, dashboard and schedules

The **one assumed-name list** is
[`projects/control-center/server/config/vacuum.json`](../../control-center/server/config/vacuum.json).
The assumed device name is **Dreame L50 Ultra**, yielding
`vacuum.dreame_l50_ultra`, `camera.dreame_l50_ultra_map`, status/battery sensors,
selects for suction, water volume, cleaning mode and carpet handling, and the
carpet-recognition switch. Availability varies by model/firmware: carpet
sensitivity may be absent when carpet recognition exists; water control may
instead be a mop-humidity select. Confirm all IDs after setup and adjust this
list to the actual exposed entities. Missing optional settings appear unavailable;
no substitute service or assumed state is sent to the device.

The separate **Vacuum** YAML dashboard is `/dashboard-vacuum`, backed by
`/config/homelab-vacuum/dashboard-vacuum.yaml`. It has the Tasshack camera and
calibration, drag-to-zone cleaning, full clean, pause, stop, dock, status, battery
and settings. Its [map templates](https://github.com/PiotrMachowski/lovelace-xiaomi-vacuum-map-card/blob/v2.4.1/docs/templates/tasshackDreameVacuum.md)
call `dreame_vacuum.vacuum_clean_zone` and `vacuum_clean_segment`.

The existing UI-managed default dashboard stays in storage mode. HA versions
with independent `resource_mode` use **`lovelace.resource_mode: yaml`** and the
pinned `/local/community/.../xiaomi-vacuum-map-card.js` module resource; existing
storage resources are carried into that declaration without modifying `.storage`.
On older HA, YAML resources require the default dashboard also to become YAML.
To preserve the existing default, provisioning instead registers the same ES
module declaratively through **`frontend.extra_module_url`**, with only the Vacuum
dashboard in YAML mode. It never writes ignored `resources` under `mode: storage`.
This compatibility choice is determined from the installed pinned HA code, not a
new deployment flag. Existing explicit resource declarations stop for reconciliation.

Room IDs **1 = living room**, **2 = bedroom** are placeholders, not observed map
IDs. `rooms_confirmed` starts false: the map shows zone mode only, the room script
is gated, and Control Center hides room buttons. Before setting it true, replace
room IDs/names in that same JSON list using the real map. The `label_position` coordinates are illustrative placeholders; replace them
with actual map positions in the same room list. Each room also accepts an
optional `outline` polygon of `[x, y]` points. No renderer changes are needed
when adding real room outlines. No real room boundaries are assumed. Confirming real IDs enables
predefined room selections and named room actions. The script uses the documented
`segments` list parameter, not an invented `segment_id` field.

The package defines a **10:00 Monday/Wednesday/Friday placeholder** full-clean
schedule. `input_boolean.vacuum_schedule_enabled` has no `initial`: a new helper
defaults off, then restores an explicit choice across restarts. Choose appropriate
times in the managed package template and enable it deliberately. There is no
automatic cleaning at deployment or Control Center startup.

Control Center exposes `/api/v1/vacuum` through its existing HA REST transport,
with observed state/battery and allowlisted start/pause/stop/dock/room commands.
The native Controls page adds a small Vacuum section with explicit refresh and
command buttons; commands are never retried after an ambiguous result. Room
commands call the shared HA script, preserving one segment mapping and owner.
The server image and native app use their normal independent delivery paths.
No web frontend exists, and no iOS build or device execution was performed here.
