# Secret ownership and provisioning

Real host ciphertext is not yet present: the host and recovery age public
recipients have not been supplied. Do not invent recipients, commit placeholders
as encrypted secrets, or reuse the live mini's private identity for the MacBook.
`secrets/README.md` describes the age key lifecycle; this document defines the
runtime contract. Nothing here authorizes reading or exporting live values.

## Host file catalog

Each `secrets/<hostname>.sops.yaml` is a SOPS YAML document with the following
keys. SOPS slash paths below refer to nested YAML keys, not filesystem paths.
Only include service keys for services assigned to that host.
Base-only bootstrap needs `tailscale-auth-key` and `github-read-token`.
Add `containers-env` only when enabling the general container runtime; an
HA-only host does not need it. Backup credentials are needed only when backups
are enabled.

| Encrypted key | Decrypted filename under `/run/secrets` | Reader / purpose |
| --- | --- | --- |
| `tailscale-auth-key` | `tailscale-auth-key` | root; host enrollment with `tag:homelab` |
| `github-read-token` | `github-read-token` | root; private repo fetch and Actions status |
| `backups/nas-credentials` | `nas-backup-credentials` | `_containers`; NAS JSON credentials and certificate pin, never mounted into a container |
| `containers-env` | `containers-env` | `_containers`; Compose settings, image pins and runtime paths |
| `services/control-center/POSTGRES_PASSWORD` | `www-POSTGRES_PASSWORD` | `_containers`; existing PostgreSQL password |
| `services/control-center/HA_TOKEN` | `www-HA_TOKEN` | `_containers`; existing HA integration token |
| `services/control-center/ALARM_API_TOKEN` | `www-ALARM_API_TOKEN` | `_containers`; existing alarm integration |
| `services/control-center/HOME_LAT` | `www-HOME_LAT` | `_containers`; private home coordinates |
| `services/control-center/HOME_LON` | `www-HOME_LON` | `_containers`; private home coordinates |
| `services/control-center/WIFI_GUEST_SSID` | `www-WIFI_GUEST_SSID` | `_containers`; guest Wi-Fi display |
| `services/control-center/WIFI_GUEST_PASSWORD` | `www-WIFI_GUEST_PASSWORD` | `_containers`; guest Wi-Fi display |
| `services/hindsight/environment` | `hindsight-env` | `_containers`; preserved runtime environment file |
| `services/cloudflared/token` | `tunnel-token` | `_containers`; existing tunnel identity |
| `services/bambuddy/environment` | `bambuddy-environment` | `_containers`; sidecar enrollment environment, if needed |

The seven Control Center filenames were verified read-only on the mini on
2026-11-03. Values were not read. Preserve the PostgreSQL password associated
with the restored database; changing its file does not change a database role's
password. Preserve the Bambuddy Tailscale state volume; do not re-enroll a second
copy while the original node is active. A migrated, authenticated sidecar may
have an empty environment file rather than another enrollment key.

The GitHub read token should have access only to the private homelab repository,
with Contents and Actions read permission. It is not a runner registration or
application release credential. Runner broker credentials still need separate declarations when that module is implemented;
they must not be added to the shared Compose environment or handed to job VMs.

## Delivery into the service VM

The SOPS module declares the catalog with owner-only read permissions.
`scripts/reconcile-service.py`, run as `_containers`, projects only the selected
service's files to `/var/lib/_containers/runtime-secrets/<service>`. Directories
are mode 0700 and files mode 0600, inside Colima's service-user home mount.
Source SOPS symlinks are resolved on macOS; the VM receives regular files.
Root-only host credentials are never included in this projection.

Files are replaced atomically only when contents change. A per-service lock
covers projection and Compose. A dirty marker is written before replacement;
Compose uses `--force-recreate` while the marker exists and clears it only after
successful startup. A failed or interrupted restart therefore retries the
rotation on the next reconciliation. Unchanged contents keep the same inode.
Control Center receives only its seven files at `/run/secrets`, cloudflared
only its token, and Hindsight only its environment file. Bambuddy receives its
own environment file and a staged copy of the public Serve configuration.

Six synthetic tests cover file permissions, unchanged inode preservation,
rotation/recreation, failed-restart retry, SOPS symlink resolution, rejection of
unsafe paths/permissions, and exclusion of unrelated host secrets. Actual
Colima mount behavior and live credential rotation still require target testing.

The per-service lock and shared host operation wrapper are implemented.
Backup and update jobs join the shared transaction protocol; runtime validation
remains pending. No secret value may enter command arguments,
logs, a generated Nix derivation, a Docker image, or a build artifact. Avoid
printing expanded `docker compose config` against real credentials; CI uses
synthetic fixtures only.

## Provision and rotate

1. Generate a distinct age identity for each host and an operator recovery
   identity. Store recovery copies in 1Password on your personal Mac, never on
   homelab nodes or runner guests, and record only public
   recipients in exact host-path rules in `.sops.yaml`.
2. Populate a host document through SOPS on a trusted operator machine. Use
   multiline YAML strings for environment files. Review encrypted diffs and
   secret key names, never paste decrypted contents into a PR or chat.
3. Confirm decryption with the intended host identity without printing values.
   After deployment approval, transfer only the host identity and a scoped GitHub
   read token over authenticated SSH into private temporary files. Bootstrap
   accepts those file paths, requires owner-only permissions, and never accesses
   a password manager. Remove the transferred files and operator export copies
   after confirming the attempt has finished; retain the protected host key and
   off-host recovery copies. A disconnected session has an unknown outcome:
   inspect the setup journal and running processes before cleanup or retry.
4. To rotate an age recipient, add it, run `sops updatekeys`, provision and test
   the new key, then remove the old recipient and update keys again.
5. To rotate a service credential, rotate it at its issuer, update the encrypted
   value, and verify delivery plus service health. Database password changes
   need coordinated database-role updates. Re-encryption alone does not revoke
   an exposed API token.

Do not enable services until real encrypted files, host-wide coordination and
on-target rotation/recovery tests are complete. Builds with no real host files cannot
prove that production ciphertext decrypts or that these credentials work.

Bootstrap invokes the built Rust `homelab-host verify-host-secrets` operation with
private input snapshots and an isolated HOME, configuration directory and
environment. Decrypted output goes directly to `/dev/null`. This prevents an
operator age recovery key from masking a wrong host identity. The locked-Nix CI check generates fresh
synthetic host/recovery/wrong keys to test both success and rejection; it writes
no real identities or ciphertext to the repository.
Input limits are 64 KiB for an age identity and 16 MiB for encrypted host secrets.

After verification, the privileged `install-host-key` operation validates the
same private working key and publishes it atomically at `/var/lib/sops-nix/key.txt`.
The directory is root-owned mode 0700 and the complete key is mode 0600 before
publication. An existing key or dangling symlink always stops installation,
including when another installer wins a race. A failure to confirm durability
after publication requires inspection; it never removes or overwrites that key.
These operations are bootstrap internals, not steps to run individually.
