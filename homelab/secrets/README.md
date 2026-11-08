# Host secrets

Only SOPS-encrypted host files belong here. No production ciphertext is committed
yet; the enrollment wizard creates it using real host and recovery recipients.
Activation remains blocked until the host's encrypted file and local age key exist.

## New Mac

Use [homelab](https://github.com/0x63616c/homelab-cli#readme) on your personal laptop.
The wizard:

1. Creates/restores the host and recovery age identities and verifies their backups
   in 1Password. You may need to unlock/approve access; you do not save files manually.
2. Obtains a scoped Tailscale enrollment key and encrypts `tailscale-auth-key` for
   both recipients in `secrets/<hostname>.sops.yaml`.
3. Opens the enrollment PR with an exact host-path rule in `.sops.yaml` and public
   configuration. Review and merge it; setup continues from that approved revision.
4. Installs only this Mac's age identity at `/var/lib/sops-nix/key.txt`, root-owned
   mode 0600. The recovery identity and 1Password access stay off the target.

Git access is separate: the target generates an SSH key, and the wizard registers
its public half as a repository-specific read-only deploy key. Its private key is
installed at `/var/lib/homelab-git/key.txt`. No GitHub token belongs in the base-host
SOPS document, and the node does not receive your GitHub account credentials.

## Resume or rotate

Resume the same saved setup after interruption. Do not delete local state, replace
keys or assume a disconnected SSH session stopped the installer. The wizard retains
protected recovery material and receipts; legacy local token files are preserved
rather than silently discarded.

Identity rotation is a separate operation: add the replacement recipient, rewrap
and verify the ciphertext with the securely provisioned new key, then remove the
old recipient and rewrap again. Verify the replacement backup in 1Password too.
Rotate a leaked service credential at its issuer; SOPS re-encryption alone does not
revoke it.

See [secret ownership and the service catalog](../docs/secrets.md) before enabling
services. Service-secret migration and Colima delivery are not part of base-host
enrollment and still need target validation.
