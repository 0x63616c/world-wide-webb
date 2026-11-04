# Service sources and migration status

These definitions preserve observed services. Nothing is enabled on either host.

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

Control Center has a local image-promotion helper and backup/update locking.
Cross-repo promotion automation and end-to-end recovery validation remain
unfinished. Keep its Compose reconciler disabled until those deployment
safeguards are verified. Runtime paths/environment
and tunnel networking must be reviewed for Colima rather than assumed to be
identical to OrbStack. In particular, host-loopback tunnel origins require testing.
