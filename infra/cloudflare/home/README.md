# Cloudflare infrastructure

OpenTofu manages retained DNS, Access applications/policies and shared tunnel ingress. Provider and tool
versions are pinned. The tunnel has prevent_destroy; automatic apply rejects deletion of retained resources.
The native app/API hostnames, Access applications and service policy retire at the coordinated cutover.
Native clients connect privately over Tailscale; Cloudflare retains only HA, Hindsight, Penpot, Beszel, Bambuddy and DSM.

State and plans use enforced built-in AES-GCM encryption. The local backend runs on the mini over SSH,
using its native exclusive state lock. Production state, variables, credentials and recovery evidence are
outside the checkout under `~/homelab-infra/cloudflare`. NAS backups include encrypted state and private
configuration. No extra cloud state service is required.

Run `bash tools/check infra` for formatting, validation, mocked routes and the isolated encryption/locking/
recovery proof. Production import and recovery-key provisioning are separate required cutover steps; source
validation alone does not transfer ownership. See `apps/control-center/docs/runbooks/native-rust-cutover.md` from the repo root.
`apps/control-center/tools/infra_apply.py` is the tested-main entry point after bootstrap. Enable its workflow only after imports,
private recovery verification and retained-service plan review. No native-device service tokens are needed. Retire obsolete app-only tokens after verifying they have no
other consumers. Preserve independent service identities and the shared tunnel.

WWW's `Apply Cloudflare` workflow connects to the existing state owner as `admin`, using
`HOMELAB_OPS_TS_CLIENT_ID`, `HOMELAB_OPS_TS_CLIENT_SECRET`, `HOMELAB_OPS_SSH_PRIVATE_KEY` and
the pinned `HOMELAB_OPS_KNOWN_HOSTS` variable. It reuses the existing `tag:homelab` OAuth
authorization. The dedicated operations public key is declared for the mini in `homelab.json`;
the private key is a GitHub Actions secret, not a human administrator key.

`OPEN_TOFU_DEPLOY_ENABLED` enables automatic application only when home infrastructure inputs
change. A manual run explicitly reconciles the configuration from its supplied successful main
CI run, even if that run selected no infrastructure changes. Both paths retain encrypted state,
OpenTofu locking, the saved-plan deletion guard and local encrypted before-copies. This workflow
does not deploy app code, activate Nix generations or replace the existing state backend.
