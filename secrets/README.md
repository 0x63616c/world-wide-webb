# Host secrets

No private keys or plaintext values belong in this repository. Real encrypted
files cannot be generated until host age public recipients are supplied.
Activation fails closed when the host file or its local age key is absent.

Create one age identity for each host, store its recovery copy in 1Password on your personal Mac,
and add only its public recipient to `.sops.yaml`. Use a separate exact
`path_regex` rule for each `secrets/<hostname>.sops.yaml`; include an operator
recovery recipient. Encrypt `tailscale-auth-key` and `github-read-token` with
SOPS for base-only setup. Add `containers-env` when enabling the general container
runtime; it is a multiline Compose environment file. Service credentials must
remain file-delivered at runtime.

Provision the host private key at `/var/lib/sops-nix/key.txt`, root-owned mode
0600, outside the Nix store. Do not copy a host identity to the other host.

Rotation: add the new public recipient, run `sops updatekeys` for affected files,
provision the new private key and verify decryption. Then remove the old
recipient and update keys again. Re-encryption does not revoke a leaked API key:
rotate the underlying credential too. Keep recovery access in 1Password on the
personal operator Mac. No homelab node or runner guest receives vault access,
a password-manager client, or the operator recovery identity. Transfer only the
individual host key and scoped bootstrap GitHub token over authenticated SSH,
and remove temporary transfer files after confirming bootstrap has finished.
After a disconnected session, inspect the journal and running processes first;
do not assume the remote process stopped when SSH ended.

See [the service secret catalog](../docs/secrets.md) for exact keys, readers and
rotation constraints. Runtime projection is implemented; Colima delivery validation and complete
bootstrap preflight are still pending. The absence of ciphertext is deliberate,
not evidence that this configuration is deployment-ready.
