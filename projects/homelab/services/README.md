# Service sources

These definitions run on the host that `homelab.json` assigns them to; see
[current state](../docs/current-state.md) and [release ownership](../docs/releases.md).

- Bambuddy: imported from `0x63616c/bambuddy-homelab` commit
  `2884b8f8239d3680e2255371fd35eea525c3c951`; image tags replaced with running
  digests observed read-only on November 3. Persistent data/studio/Tailscale
  volumes are external so missing restores fail rather than create empty state.
- Control Center, HA, cloudflared: imported from `0x63616c/world-wide-webb`
  commit `3368a603cd162caac37e558f4fe88bcafe115b37`, `deploy/mini/`.
- Hindsight: converted from the inspected running container (image digest,
  bind destinations, ports and restart policy). Its existing environment file
  must be encrypted/provisioned separately. No environment values were copied.

The general `services` Colima runtime does not run HA: HA has its own bridged VM and
ha0/default-route readiness logic.

Before assigning a service to a host: stop its old writers, back up, restore the real
persistent data into the destination runtime, provision secrets, then change the
assignment and verify application state. Do not copy a live database directory. Do not
start duplicated HA automations or a duplicated Bambuddy Tailscale identity on two hosts.

Control Center now uses native Rust/SQLite, an external persistent SQLite volume and
preserved media. Its image is pinned in `control-center/release.json`; host transactional
activation supplies backup/update locking. Do not introduce a second deployer or worker.

Tapes is built in this repository (`projects/tapes/server`). Its image is pinned in
`tapes/release.json` by promotion; progress lives on the external `tapes_data` volume
and the library is a read-only NFS mount from the NAS ([tapes](../docs/tapes.md)).
