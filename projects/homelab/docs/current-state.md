# Current state

Both Macs are configured from `projects/homelab` in this repository and follow the
`deploy/homelab` branch through Comin. This page states what the repository declares.
Read the installed revision and `/var/lib/homelab-operations/last-success.json` on a
host before a live change; the repository cannot show what a host has accepted.

## Hosts

| Host               | Role                                    | Administrator     | Tailscale IPv4  |
| ------------------ | --------------------------------------- | ----------------- | --------------- |
| `homelab-mac-mini` | Production services, backups, OpenTofu  | `admin` (UID 501) | `100.73.156.11` |
| `homelab-macbook`  | CI runner pool and the `coding` account | `admin` (UID 501) | `100.96.15.83`  |

`homelab.json` is the source for administrators, authorised SSH keys and service
assignment. `hosts/<name>.nix` holds each host's settings.

### Mac mini

- M2, 8 GB. The services VM has 4 GiB and the Home Assistant VM 3 GiB, leaving about
  1 GiB for macOS. Watch memory pressure.
- Assigned services: `control-center`, `bambuddy`, `hindsight`, `cloudflared`, `beszel`,
  `golink` and `home-assistant`.
- Home Assistant runs as a container in its own bridged Colima VM on `en1`, at
  `192.168.0.130/24` with gateway `192.168.0.1`. Its LAN UI is `http://192.168.0.130:8123`.
  The other services share the `services` Colima VM.
- Local ports: Control Center `127.0.0.1:4202`, Bambuddy `127.0.0.1:8000`, Beszel
  `127.0.0.1:8090`, Hindsight `8888` and `9999` on all interfaces.
- Tailnet names: the Control Center apps use `https://homelab.tail8c014d.ts.net`
  ([access](control-center-access.md)), Bambuddy has its own node
  `bambuddy.tail8c014d.ts.net` and golink answers at `go.tail8c014d.ts.net`
  ([golink](golink.md)).
- Control Center workers are enabled, and the bedroom wall switch is bound to
  `binary_sensor.shelly_bedroom_input_0` ([operations](operations.md)).
- Backups are enabled: a full set daily at 04:15 and a Control Center set every hour.
  A separate job publishes pending sets to the NAS ([backups](backups.md)).
- Private images are pulled with the SOPS-installed registry configuration; no login
  session is needed on the host ([secrets](secrets.md)).
- No CI runners.

### MacBook

- M2, 32 GB, about 500 GB. `caffeinate` keeps it awake on AC with the lid closed.
- No assigned services.
- Runner pool: four jobs in total, at most two macOS guests, in disposable Tart guests.
  It serves `0x63616c/world-wide-webb` and, temporarily, `Virtual-Outfit-Vault/vov`
  ([Linux runners](linux-runners.md), [runner operations](operations-runners.md)).
- The non-administrator `coding` account (UID 502) with its tools and Xcode 27.2
  ([coding](coding.md), [Rex](rex.md)).

## Updates

A selected, successful Homelab CI run on `main` lets the promotion workflow advance
`deploy/homelab`. Comin polls that branch every 30 seconds. On the Mini the stateful
transaction backs up, activates, reconciles and health-checks the selected services
under the host operation lock ([updates](updates.md)). Control Center images arrive as
a pin change to `services/control-center/release.json` ([releases](releases.md)).

## Known issues

- After a power cycle on 11 November 2026 the services VM reported Running but never
  booted. The cause is unconfirmed. The startup supervisor now stops an unreachable
  guest so launchd can retry; its log is `/var/lib/_containers/colima-startup.log`.
- The Mini has little memory headroom (see above).
- The registry credential is the existing Homelab PAT, which has more than
  `read:packages`. A narrower token would reduce its access; pulls do not need one.
- Penpot is no longer assigned to a host, but its service definition, backup scope and
  secrets entries are still in the repository until its retirement is finished.
- No isolated restore of a real backup set is recorded in this repository
  ([restore rehearsal](restore-rehearsal.md)).
