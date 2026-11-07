# Cloudflare infrastructure

OpenTofu manages retained DNS, Access applications/policies and shared tunnel ingress. Provider and tool
versions are pinned. The tunnel has prevent_destroy; automatic apply rejects deletion of retained resources.
The native app/API hostnames, Access applications and service policy retire at the coordinated cutover.
Native clients connect privately over Tailscale; Cloudflare retains only HA, Hindsight, Bambuddy and DSM.

State and plans use enforced built-in AES-GCM encryption. The local backend runs on the mini over SSH,
using its native exclusive state lock. Production state, variables, credentials and recovery evidence are
outside the checkout under `~/homelab-infra/cloudflare`. NAS backups include encrypted state and private
configuration. No extra cloud state service is required.

Run `bash tools/check infra` for formatting, validation, mocked routes and the isolated encryption/locking/
recovery proof. Production import and recovery-key provisioning are separate required cutover steps; source
validation alone does not transfer ownership. See `docs/runbooks/native-rust-cutover.md` from the repo root.
`tools/infra_apply.py` is the tested-main entry point after bootstrap. Enable its workflow only after imports,
private recovery verification and retained-service plan review. No native-device service tokens are needed. Retire obsolete app-only tokens after verifying they have no
other consumers. Preserve independent service identities and the shared tunnel.
