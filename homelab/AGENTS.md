# Homelab instructions

For host, runner, service or recovery changes, read `README.md`, `docs/current-state.md`
and the relevant operations/runbook before changing ownership. The migration tracker at
`../docs/plans/monorepo-migration-progress.md` records which source currently controls live hosts.

Root `homelab.json`, `flake.lock`, `bootstrap/installer.json`, `.sops.yaml` and host ciphertext
are canonical regular files required by enrollment guards. Preserve approved setup receipts,
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

## Mini deployment and registry auth

For Mini deployment or registry failures, read `docs/current-state.md`, `docs/releases.md`
and `docs/secrets.md` before provisioning credentials. This is the verified November 11,
2026 baseline; inspect current code for subsequent changes.

- Deployment follows `main` → required CI → `deploy/homelab` → Comin (30-second polling,
  read-only Git SSH deploy key). The stateful transaction owns backup, activation,
  reconciliation and health. Application services run as `_containers`.
- Private Control Center images use `ghcr.io/0x63616c/www-control-center-mini`.
  Auth reuses the existing Homelab PAT in the `homelab` 1Password vault, item
  **GitHub Personal Access Token** (`dewmvuagsxajla6zs5oy6e6hva`). This is a lookup
  reference only; apply the root credential rules when retrieval is necessary.
- Repo-root `secrets/homelab-mac-mini.sops.yaml`, key
  `services/registry/docker-config`, supplies `/run/secrets/registry/config.json`
  (owner `_containers`, mode 0400). Preflight and normal reconciliation use
  `DOCKER_CONFIG=/run/secrets/registry`. The existing PAT retains its repository/package-write
  scopes. The Mini needs neither interactive Docker login nor a vault client.
- The Homelab GitHub Runners App manages runner registration; Comin Git access and
  Docker registry auth are separate. Inspect existing wiring and test registry access
  as the service account before requesting another token. Cached images can mask
  missing auth, as documented in PR #981.
- [PR #1040](https://github.com/0x63616c/world-wide-webb/pull/1040) verified authenticated
  pulls and hot HA bridge replacement without a host reboot: stop the existing guest,
  await bridge teardown, activate, restart and check LAN HTTP. The incident's “reset”
  meant unplugging/reconnecting power, not a wipe or rebuild; the auth gap predated it.
