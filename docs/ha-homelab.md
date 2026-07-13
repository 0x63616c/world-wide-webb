# Home Assistant on the Homelab

Home Assistant runs as **HAOS inside a QEMU VM** on the homelab Mac, not as a
container. The control-center API talks to it over HTTP. This doc captures the
topology and the runbook that came out of the 2026-07-12 Apple TV incident.

## Topology

- **Host**: the homelab Mac — `ssh homelab.tail8c014d.ts.net` (hostname
  `captive-portal.worldwidewebb.co`).
- **VM**: HAOS under `qemu-system-aarch64`, 2GB RAM (tight — see Notes). VM
  files and the `stop-haos.sh` / `start-haos.sh` control scripts live in
  `/Users/calum/homeassistant-os/`. The VM's LAN IP is **`192.168.0.38`**.
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
- **VM restart**: use `stop-haos.sh` then `start-haos.sh`. **Do not** `kill`
  the QEMU process — that's an unclean guest shutdown, and repeated unclean
  shutdowns risk recorder-DB corruption (see the incident above).
- **Check core health** at the observer page (`:4357`) before assuming the API
  is the problem.

### Config entry IDs

| Device | Entry ID |
| --- | --- |
| Living Room TV | `01KNZNSK3ZJMRS3PZAWKG7XY7G` |
| Bathroom (2) | `01KNZNT4W36VBM3RT2AW0Q81R0` |

## Notes

- The VM is provisioned with **2GB RAM, which is tight** for HAOS + recorder +
  add-ons. Consider bumping to 4GB.
- Plex was deployed to the same homelab k3s cluster on the same day — see
  [`plex.md`](./plex.md) (note the `ADVERTISE_IP` LAN-reachability caveat, which
  is the same class of Mac-LAN-IP dependency as the HA socat proxy here).
</content>
</invoke>
