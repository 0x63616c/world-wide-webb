# UniFi logging → NAS (syslog + NetFlow)

How the UniFi Cloud Gateway Fiber's logs land on the Synology NAS, and how to reproduce it. (www-dhi9)

## What & why

Two independent streams from the gateway/APs are archived to the **`Unifi` shared folder** on the
Synology (`NAS - HomeTB`, DS420+, `192.168.0.218`, `/volume1/Unifi`):

| Stream | Data | Transport | Receiver | Lands in |
|---|---|---|---|---|
| **Syslog** | events: firewall blocks, client connect/disconnect, DHCP, AP telemetry | UDP/TCP 514 | `unifi-syslog` (syslog-ng container) | `/volume1/Unifi/logs/syslog/YYYY-MM-DD-unifi.log` |
| **NetFlow/IPFIX** | per-connection flow records (who↔who, ports, bytes, packets) | UDP 2055 | `unifi-netflow` (goflow2 container) | `/volume1/Unifi/logs/netflow/flows.json` → daily `YYYY-MM-DD-flows.json.gz` |

**Why the receivers live on the NAS (not our k3s cluster):** Docker is already on the NAS;
our cluster can't reliably publish UDP host ports for an external sender, and pods can't reach the
NAS over NFS under the OrbStack pod-egress limits (www-6mz7). syslog is text →
syslog-ng; NetFlow is binary IPFIX that Synology's Log Center can't read → goflow2 decodes it to NDJSON
(one JSON object per line).

## Architecture

```
UCG Fiber (192.168.0.1) ──UDP 514  syslog──▶  unifi-syslog (syslog-ng)  ──▶ /volume1/Unifi/logs/syslog/
                        ──UDP 2055 IPFIX ───▶  unifi-netflow (goflow2)   ──▶ /volume1/Unifi/logs/netflow/
```

## The API-key insight (www-dhi9)

The `op://Homelab/UniFi/local_api_key` is **not** read-only. With the `X-API-KEY` header it authenticates
against the **private controller API** (`/proxy/network/api/s/default/...`), including `set/setting`. The
NetFlow collector address (`server`) and the remote-syslog target are **not** in the read-only
integration API, but they ARE writable via `set/setting/{netflow,rsyslogd}`. `scripts/configure-unifi-log-export.sh`
does exactly this. (`get/setting` also returns gateway secrets, treat its output as sensitive.)

Gateway settings applied:
- `netflow`: `enabled`, `server=<NAS>`, `port=2055`, `version=10` (IPFIX), `sampling_mode=off` (full flows),
  `export_frequency=1`, `network_ids=[<LAN>]`.
- `rsyslogd`: `this_controller=false` (= "SIEM Server" mode, UniFi syslog is internal-OR-remote, not both),
  `ip=<NAS>`, `port=514`.

## Continuous enrichment (www-cs0o)

A third container, **`unifi-enrich`**, tails `flows.json` incrementally (~5s lag) and appends
**`enriched-flows.json`**: every flow gains `src_name`/`dst_name` (device names), and external IPs gain
`*_rdns` + `*_org` (ASN). Raw stays raw. It holds **zero credentials**: names come from the non-secret
`ip_names.json` map pushed by `push-unifi-names.sh` (the UniFi key never leaves the dev box), with
gateway PTR as fallback; rDNS is cached 24 h (negative hits too) and ASN/org cached forever (Team Cymru
bulk), so steady-state lookup traffic is ~zero. Re-run `push-unifi-names.sh` after renaming devices in
UniFi. Rotation produces `YYYY-MM-DD-enriched-flows.json.gz` alongside the raw archive.

## Reproduce / operate (all from the dev box; creds via `op`)

```bash
./scripts/save-synology-dsm.sh          # one-time: store the DSM admin login in 1Password
./scripts/setup-unifi-log-receivers.sh  # build/refresh the three containers on the NAS (incl. enricher)
./scripts/configure-unifi-log-export.sh # point the gateway at the NAS (DISABLE=1 to turn off)
./scripts/push-unifi-names.sh           # refresh the ip->device-name map the enricher uses
./scripts/unifi-flow-report.sh          # ad-hoc report: top LAN talkers + external endpoints (rDNS+ASN)
```

NAS-side files: `unifi-syslog-ng.conf` (syslog-ng config), `unifi-rotate-netflow.sh` (daily rotation,
deployed to `/volume1/Unifi/docker/`, run by a `/etc/crontab` entry at 23:59).

## Rotation & retention

- Syslog rotates natively (daily file per `${R_YEAR}${R_MONTH}${R_DAY}`).
- NetFlow is rotated by `unifi-rotate-netflow.sh` (cron 23:59): rename `flows.json` → `YYYY-MM-DD-flows.json`,
  restart goflow2 to reopen a fresh file, then gzip the closed day (gzip deletes the uncompressed
  original, only the `.gz` remains; read with `zcat`/`zgrep`). Measured ~36× compression (136 MB → 3.8 MB).
- **Retention = keep forever** (`RETENTION_DAYS=0`). Measured volume ≈ **1.1 GB/day** (NetFlow ~95%, busy-period
  upper bound); 365 days ≈ 430 GB = ~7% of the NAS's 6 TB free, and gzip'd NetFlow shrinks ~8-12×, so
  "forever" is comfortable. Set `RETENTION_DAYS>0` in the rotate script to prune both streams later.

## Verify it's flowing

```bash
# on the NAS:
tail -f /volume1/Unifi/logs/syslog/$(date +%F)-unifi.log     # live events
tail -1 /volume1/Unifi/logs/netflow/flows.json | python3 -m json.tool   # a flow record
```

## Containers (on the NAS, Docker)

- `unifi-netflow`: `netsampler/goflow2`, `-listen netflow://:2055 -format json -transport.file /output/flows.json`
- `unifi-syslog`: `balabit/syslog-ng`, UDP+TCP 514, config bind-mounted from `/volume1/Unifi/docker/syslog-ng/`

Both `--restart unless-stopped`. goflow2 runs non-root, so the netflow log dir is `chmod 0777`.
