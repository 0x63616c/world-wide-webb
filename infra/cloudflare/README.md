# Cloudflare infrastructure

OpenTofu manages retained DNS, Access applications/policies and shared tunnel ingress. Provider and tool
versions are pinned. The tunnel has prevent_destroy; automatic apply rejects deletion of retained resources.
The retired app hostname may be removed only after native API access works.

State and plans use enforced built-in AES-GCM encryption. The local backend runs on the mini over SSH,
using its native exclusive state lock. Production state, variables, credentials and recovery evidence are
outside the checkout under `~/homelab-infra/cloudflare`. NAS backups include encrypted state and private
configuration. No extra cloud state service is required.

Run `bash tools/check infra` for formatting, validation, mocked routes and the isolated encryption/locking/
recovery proof. Production import and recovery-key provisioning are separate required cutover steps; source
validation alone does not transfer ownership. See `docs/runbooks/native-rust-cutover.md` from the repo root.
`tools/infra_apply.py` is the tested-main entry point after bootstrap. Enable its workflow only after imports,
private recovery verification and retained-service plan review. Device service tokens are provisioned privately;
only their IDs belong in infrastructure inputs. Never bundle token secrets in Apple builds.
