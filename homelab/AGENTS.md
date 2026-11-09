# Homelab instructions

For host, runner, service or recovery changes, read `README.md`, `docs/current-state.md`
and the relevant operations/runbook before changing ownership. The migration tracker at
`../docs/plans/monorepo-migration-progress.md` records which source currently controls live hosts.

Root `homelab.json`, `flake.lock`, `bootstrap/installer.json`, `.sops.yaml` and host ciphertext
are canonical regular files required by enrollment guards. Preserve approved setup receipts,
journals, host identities, age recovery material and exact revisions during repository rebind.

Build the CLI and host tools from their filtered local Nix source sets. Keep package inputs
independent of app assets. Main is the authoring branch; the planned `deploy/homelab` handover
requires explicit promotion and current-state verification before a host follows it.

Use the root working/credential rules. Verification builds must not activate hosts, release
maintenance holds, register runners or change Serve routes. Live changes preserve operation locks,
resource admission, backups and independently owned services. Check the installed revision and one or
two affected core flows after a handover. Reboot/restore rehearsals are needed only for changes to
those mechanisms, explicit task requirements or actual failures; reuse valid existing evidence.
Active CLI repair work remains protected until merged.
