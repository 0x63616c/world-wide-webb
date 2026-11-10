# Secrets and recovery

The enrollment wizard handles base-host secrets. **1Password stays on the
personal laptop; Git stores ciphertext; each Mac receives only its own identity
and runtime credentials.** Host ciphertext stays encrypted in Git.

## What setup does

Run [homelab](../cli/README.md) on the personal
laptop. Unlock 1Password and approve GitHub access when prompted; no manual token
pasting, key-file copying or backup checkbox is required.

1. Create or restore a distinct host age identity and a separate recovery
   identity. Save both backups in the configured 1Password vault, read them back
   and verify their identities before proceeding. Existing keys are preserved.
2. Read the dedicated Tailscale provisioning credential on the client and issue
   a single-use, expiring enrollment key for the configured tag. The provisioning
   credential never goes to the node. Tailnet SSH access policy is a separate
   prerequisite; issuing a key does not grant SSH access.
3. Generate a Git SSH key on the target and register its public half as a
   **read-only deploy key for this repository**, using the client's GitHub login.
   The private key remains on that Mac. No GitHub account token, Actions permission
   or GitHub token in SOPS is needed by the node.
4. Encrypt `tailscale-auth-key` for the host and recovery recipients. Verify
   decryption independently with each identity. Open the enrollment PR containing
   ciphertext, exact host recipient rules and public setup configuration.
5. After the PR is merged, install that approved revision. Transfer the host age
   identity over trusted SSH; never transfer the recovery identity. Bootstrap
   verifies the ciphertext with the host key alone, then installs protected files.
6. Check services, Git read access and Tailscale SSH, restart and verify again
   before releasing the Git-update hold. Authentication or FileVault unlock may
   still require the user. The wizard does not approve migration of existing data.

These are implementation responsibilities, not separate commands to remember.
See the [setup guide](../cli/docs/setup.md)
for prerequisites and recovery prompts.

## Where secrets live

- **1Password:** verified host/recovery age backups and the Tailscale provisioning
  credential. The adapter runs only on the client. Nodes and runner guests have
  no vault access or password-manager installation.
- **Git:** `secrets/<hostname>.sops.yaml` and public recipients in `.sops.yaml`.
  Each host has its own exact-path rule with its host and recovery recipients.
- **Target:** age key at `/var/lib/sops-nix/key.txt`; Git deploy key at
  `/var/lib/homelab-git/key.txt`, both root-owned mode 0600. SOPS decrypts selected
  runtime secrets under `/run/secrets` with owner-only access. Secrets do not
  belong in the Nix store, build artifacts, command arguments or logs.
- **Client state:** `~/.local/state/homelab/provisioning` retains protected local
  identities, backup receipts, encrypted preparations and enrollment progress for
  resumption. Expired preparations are archived with their issuance/revocation
  evidence. Do not commit this directory or delete it to bypass an error.

Temporary remote staging is cleaned after its outcome is established. A lost
SSH connection does not prove that installation stopped. Resume the same attempt;
uncertain mutations remain blocked until reconciled. Before bootstrap starts,
expired preparation can be renewed through a replacement PR. After activation,
completion uses the installed revision without requiring a fresh enrollment key.
Legacy local token files are preserved for recovery, not used for new enrollment.

## Service secret catalog — migration not yet enabled

The base-host SOPS file needs only `tailscale-auth-key` (root, mode 0400).
The remaining declarations in [modules/secrets.nix](../modules/secrets.nix) are
conditional on enabled services/backups. The enrollment wizard does not collect
or migrate these service credentials. Current Git reconciliation supports base
hosts only; service activation needs a separately tested migration workflow.

| Encrypted key | File under `/run/secrets` | Purpose |
| --- | --- | --- |
| `containers-env` | `containers-env` | Shared Compose environment when the container runtime is enabled |
| `backups/nas-credentials` | `nas-backup-credentials` | NAS credentials and certificate pin; not mounted into containers |
| `services/control-center/POSTGRES_PASSWORD` | `www-POSTGRES_PASSWORD` | Existing database password |
| `services/control-center/HA_TOKEN` | `www-HA_TOKEN` | Home Assistant integration |
| `services/control-center/ALARM_API_TOKEN` | `www-ALARM_API_TOKEN` | Alarm integration |
| `services/control-center/HOME_LAT` | `www-HOME_LAT` | Home latitude |
| `services/control-center/HOME_LON` | `www-HOME_LON` | Home longitude |
| `services/control-center/WIFI_GUEST_SSID` | `www-WIFI_GUEST_SSID` | Guest network display |
| `services/control-center/WIFI_GUEST_PASSWORD` | `www-WIFI_GUEST_PASSWORD` | Guest network password |
| `services/hindsight/environment` | `hindsight-env` | Existing Hindsight environment |
| `services/cloudflared/token` | `tunnel-token` | Existing tunnel identity |
| `services/bambuddy/environment` | `bambuddy-environment` | Sidecar enrollment settings, if needed |

These service files are owned by `_containers`, mode 0400. The dormant
[scripts/reconcile-service.py](../scripts/reconcile-service.py) projects only the
selected service's files into `/var/lib/_containers/runtime-secrets/<service>`
(mode 0700 directories, 0600 files), within Colima's service-user home mount.
Root-only host credentials are excluded. Changed files trigger container recreation;
a failed restart retains a retry marker. Synthetic tests cover this mechanism;
actual Colima delivery, service migration and rotation still need target validation.

The Control Center names were observed on the mini on 2026-11-03 without reading
values. Preserve its existing database password when restoring that database.
Preserve Bambuddy's authenticated Tailscale state volume; do not enroll a duplicate
sidecar while the original is active.

## Later rotation and recovery

- **Age identity:** add the new recipient, rewrap affected SOPS files, securely
  provision and verify the new private key, then remove the old recipient and
  rewrap again. Update and verify its recovery backup. This is a separate planned
  rotation; the enrollment wizard deliberately does not overwrite unexpected keys.
- **Service credential:** rotate at the issuer and update encrypted configuration,
  then verify service health. Database password changes also require changing the
  database role; replacing a secret file alone is insufficient.
- **Git deploy key:** create/register a replacement for this repository, install it
  securely and prove read access before revoking the old key. Rotation is not an
  enrollment retry.

Re-encryption does not revoke exposed credentials or erase old Git history.
1Password recovery access must survive losing the Macs; age-key backups do not
replace database or service-data backups.
