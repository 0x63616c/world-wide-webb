# State-storage bootstrap

This root owns the private R2 state bucket and the existing owner-operated deployment API token. It uses encrypted local bootstrap state because the bucket does not exist yet. Back up that encrypted state as a 1Password document before moving on; preserve its separate passphrase in the Folding vault. This is not the production-state fallback.

The production root must use remote state with proven locking before applying mail/backend infrastructure. No public R2 access, lifecycle deletion, or unrelated account resource is managed here. The default provider receives its operator credential through the authorized environment.
Only the aliased token-minter provider receives the sensitive `token_minter` input. The
`deployment_token` output is sensitive: pass it directly into the approved secret store;
never print it, decrypted state or plan content. The token value stays encrypted in state.
This owner-operated identity is not the imported CI identity. Dedicated CI credentials and
live delivery acceptance remain required before enabling the new app publisher.

Pinned tools: OpenTofu 1.13.9, Cloudflare provider 5.28.1. Never delete the bucket to recover state. Restore the saved bootstrap state or import the existing bucket explicitly.
