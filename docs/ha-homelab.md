# Home Assistant on the Homelab

Home Assistant runs as **HAOS inside a QEMU VM** on the homelab Mac, not as a
container. The control-center API talks to it over HTTP. This doc captures the
topology and the runbook that came out of the 2026-07-12 Apple TV incident.

## Topology

- **Host**: the homelab Mac — `ssh homelab.tail8c014d.ts.net` (hostname
  `captive-portal.worldwidewebb.co`).
- **VM**: HAOS under `qemu-system-aarch64`, 2GB RAM (tight — see Notes). VM
  files live in `/Users/calum/homeassistant-os/`, and the `start-haos.sh` /
  `stop-haos.sh` control scripts are *installed* there — but their **source of
  truth is `infra/homelab/haos/` in this repo**, applied by
  `scripts/install-haos.sh`. Never hand-edit the copies on the box;
  `./scripts/install-haos.sh --check` fails on drift. The VM's LAN IP is
  **`192.168.0.38`**.
- **Guest console + control channel** (since 2026-07-24):
  - `/tmp/haos-serial.log` — the guest serial console (kernel, systemd,
    supervisor). This is the *only* window into a guest that won't serve `:8123`.
  - `/tmp/haos-mon.sock` — QEMU monitor socket, which is what makes a clean
    ACPI shutdown possible. Both are per-boot; a VM started before 2026-07-24
    has neither.
- **launchd jobs** (on the Mac):
  - `com.homeassistant.os` — runs the QEMU VM.
  - `com.homeassistant.proxy` — `socat *:8123 → 192.168.0.38:8123`, so the
    tailnet host port `8123` reaches HA core inside the VM.
- **Observer**: HAOS health page on **`:4357`** — stays up even when HA core
  is down/hung, so it's the first thing to check.
- **k8s**: an `ExternalName` Service `ha` →
  `homelab.tail8c014d.ts.net:8123` exposes HA to the cluster.
- **API token**: k8s secret `control-center-secrets-api`, key **`HA_TOKEN`**
  (context `cc-homelab`, namespace `control-center`).

## Incident: wedged Apple TV Companion service (2026-07-12)

The Living Room Apple TV (`AppleTV11,1`, tvOS 26.5, `192.168.0.6`) developed a
**wedged Companion service**. Symptom chain:

1. The `media_player` entity went stale / showed `off` while the TV was on.
2. `remote.send_command` returned HTTP `200` but **hung HA's event loop
   server-side** — subsequent API calls returned HTTP `000` (connection hang).
3. Repeated hangs escalated to HA core crash-looping / hanging even after the
   config entry was disabled. This is **suspected** to be recorder-DB damage
   from ~5 unclean VM shutdowns during recovery attempts — *(unverified at time
   of writing)*.

Key discrimination: the **MRP / AirPlay path** (`media_player.play_media`, deep
links) kept working whenever core was healthy. **Only the Companion path**
(`send_command`, power) wedges.

## Runbook

- **Never spam `remote.send_command`** when presses don't land. It's a *hang*,
  not a no-op — each retry piles onto the blocked event loop and makes core
  worse.
- **Reload the config entry** (soft first step) via REST:
  ```sh
  curl -X POST \
    -H "Authorization: Bearer $HA_TOKEN" \
    http://homelab.tail8c014d.ts.net:8123/api/config/config_entries/entry/<id>/reload
  ```
- **Disable / re-enable the entry** over the WebSocket API (helper-script
  pattern): send `config_entries/disable` with `disabled_by: "user"`, then
  re-enable with `disabled_by: null`.
- **Durable fix for a wedged Companion**: physically restart the Apple TV. The
  soft steps above only clear it temporarily.
- **VM restart**:
  ```sh
  ~/homeassistant-os/stop-haos.sh
  launchctl kickstart -k gui/$(id -u)/com.homeassistant.os
  ```
  `stop-haos.sh` now sends ACPI `system_powerdown` over the monitor socket and
  only falls back to `SIGTERM`/`SIGKILL` loudly. **A clean stop prints
  `guest shut down cleanly`; anything containing `FALLBACK:` was unclean** —
  check the recorder afterwards.

  > **CORRECTION (2026-07-24).** This doc previously said `stop-haos.sh` was the
  > clean path. It was not. The old script was a bare
  > `kill "$(cat "$PIDFILE")"` — SIGTERM to *QEMU*, i.e. a power-cut to the
  > guest, which is exactly the "repeated unclean shutdowns" the warning below
  > was about. Following this runbook was *causing* the damage it warned of.
- **Do not** `kill` the QEMU process directly — that is an unclean guest
  shutdown, and repeated unclean shutdowns risk recorder-DB corruption (see the
  incidents above).
- **Check core health** at the observer page (`:4357`) before assuming the API
  is the problem.

### Config entry IDs

| Device | Entry ID |
| --- | --- |
| Living Room TV | `01KNZNSK3ZJMRS3PZAWKG7XY7G` |
| Bathroom (2) | `01KNZNT4W36VBM3RT2AW0Q81R0` |

## Incident: Core died with the port refused (2026-07-24)

At **07:52:58 PDT** Core stopped dead. Symptoms, and what each one ruled out:

| Observation | What it means |
| --- | --- |
| `:8123` **refused** in ~25–37ms, 1521× consecutively | Nothing listening. **Not** a wedged event loop — a wedged loop keeps the socket bound and produces *hangs/timeouts*, not refusals. |
| Observer `:4357` = 200, `/supervisor/ping` = 200 | Guest OS and supervisor were **fine**. Only Core was gone. |
| QEMU at ~2% CPU, `haos.qcow2` mtime still advancing | Guest alive and writing. **No recorder rebuild in progress** (a rebuild pegs CPU). |
| `haos.qcow2` size flat at 12,742,557,696 B | Not a signal — the image is fully allocated, so its size *cannot* change. |
| After restart: `Ended unfinished session (id=97 from 2026-07-24 14:52:58Z)` | Confirms Core died **abruptly at 07:52:58 PDT** with no clean shutdown. |

Recovery was a VM restart; `:8123` answered **31 seconds** later and the recorder
recovered **without** a rebuild.

**Root cause: not conclusively established.** The serial console was only enabled
*during* this recovery, so it captured the new boot, not the death. What we know:

- `pyatv.protocols.companion` logged `Could not fetch SystemStatus (Command
  FetchAttentionState failed)` **39 seconds into the new boot**, plus `apple_tv:
  Failed to update app list` — the same Companion signature as the 2026-07-12
  incident above. That is the leading suspect.
- A guest-internal OOM could not be ruled in or out: HA has **no `systemmonitor`
  sensors configured**, so guest memory pressure is not measurable from outside.
  Worth adding.

A plausible chain fitting all of it: the Companion wedge blocked the event loop
from ~07:41 (the flapping/timeout phase), then Core was killed or crashed
outright at 07:52:58 (hence refusals, not hangs), and nothing brought it back
while the supervisor stayed healthy. **Next occurrence, read
`/tmp/haos-serial.log` first** — that is precisely the gap it was added to close.

## Notes

- The VM is provisioned with **2GB RAM, which is tight** for HAOS + recorder +
  add-ons. Bumping it is **not** a free change: the 8GB host also runs the
  OrbStack VM, and the budget (`4096 OrbStack + 2048 HAOS + ~2048 macOS`) is
  fully committed. Raising `HAOS_MEM` means lowering `TARGET_MEM_MIB` in
  `scripts/provision-orbstack.sh` by the same amount. See
  [`homelab-host.md`](./homelab-host.md).
- Plex was deployed to the same homelab k3s cluster on the same day — see
  [`plex.md`](./plex.md) (note the `ADVERTISE_IP` LAN-reachability caveat, which
  is the same class of Mac-LAN-IP dependency as the HA socat proxy here).

