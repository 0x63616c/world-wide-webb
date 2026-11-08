# State-storage bootstrap

This root creates only the private R2 state bucket. It uses encrypted local bootstrap state because the bucket does not exist yet. Back up that encrypted state as a 1Password document before moving on; preserve its separate passphrase in the Folding vault. This is not the production-state fallback.

The production root must use remote state with proven locking before applying mail/backend infrastructure. No public R2 access, lifecycle deletion, or unrelated account resource is managed here. API tokens come from environment variables; no token values are input variables or outputs.

Pinned tools: OpenTofu 1.13.9, Cloudflare provider 5.28.1. Never delete the bucket to recover state. Restore the saved bootstrap state or import the existing bucket explicitly.
