# Service sources and migration status

These definitions preserve the independently owned services. Read-only inspection on
November 8, 2026 found the mini assigned Control Center, Bambuddy, Hindsight, cloudflared,
Penpot, Beszel and Home Assistant, with shared backups configured. Its installed source
still belongs to the original homelab repository; WWW authority handover remains pending.
See [release ownership](../docs/releases.md) and the root migration progress for acceptance.

- Bambuddy: imported from `0x63616c/bambuddy-homelab` commit
  `2884b8f8239d3680e2255371fd35eea525c3c951`; image tags replaced with running
  digests observed read-only on November 3. Persistent data/studio/Tailscale
  volumes are external so missing restores fail rather than create empty state.
- Control Center, HA, cloudflared: imported from `0x63616c/world-wide-webb`
  commit `3368a603cd162caac37e558f4fe88bcafe115b37`, `deploy/mini/`.
- Hindsight: converted from the inspected running container (image digest,
  bind destinations, ports and restart policy). Its existing environment file
  must be encrypted/provisioned separately. No environment values were copied.

The service-owned general Colima runtime does NOT run HA: HA requires its own
bridged VM and the current ha0/default-route readiness logic. The imported HA
Compose is retained for that migration, not enabled in the generic service list.

Before activating any service: pause the old deployer, stop old writers, back up,
restore the real persistent data into the destination runtime, provision secrets,
then change host service assignment and verify application state. Do not copy a
live database directory. Do not simultaneously start duplicated HA automations
or duplicated Bambuddy Tailscale identity on both hosts.

Control Center now uses native Rust/SQLite, an external persistent SQLite volume and
preserved media. The local image-promotion helper validates immutable source/digest inputs;
host transactional activation supplies backup/update locking. Automatic consolidated app
promotion and actual restore acceptance remain unfinished. Do not re-enable the obsolete
retired-user app deployer or introduce another worker. Use the installed Colima runtime and
preserve the independently owned HA VM, tunnel routes, backups and service assignments.
