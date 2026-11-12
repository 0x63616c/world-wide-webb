# Homelab instructions

For host, runner, service or recovery changes, read `README.md`, `docs/current-state.md`
and the relevant operations/runbook before changing ownership. The migration tracker at
`../docs/plans/monorepo-migration-progress.md` records which source currently controls live hosts.

`flake.nix` and `flake.lock` live here; root `homelab.json`, `bootstrap/installer.json`,
`.sops.yaml` and host ciphertext remain canonical regular enrollment files. Preserve approved setup receipts,
journals, host identities, age recovery material and exact revisions during repository rebind.

Build the CLI and host tools from their filtered local Nix source sets. Keep package inputs
independent of app assets. Main is the authoring branch; checked changes are promoted to
`deploy/homelab`, which both Macs follow in WWW. Preserve that promotion boundary; the old source repository was deleted.

Use the root working/credential rules. Verification builds must not activate hosts, release
maintenance holds, register runners or change Serve routes. Live changes preserve operation locks,
resource admission, backups and independently owned services. Check the installed revision and one or
two affected core flows after a handover. Reboot/restore rehearsals are needed only for changes to
those mechanisms, explicit task requirements or actual failures; reuse valid existing evidence.
Active CLI repair work remains protected until merged.
