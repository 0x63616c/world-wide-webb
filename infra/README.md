# Infrastructure ownership

OpenTofu owns durable Cloudflare resources. Wrangler owns Worker code versions, generated bindings and D1 migrations; it must not recreate resources managed here.

| Resource | Owner | State |
| --- | --- | --- |
| Private `folding-infrastructure-state` R2 bucket | `bootstrap/` OpenTofu root | Encrypted bootstrap state, recovery copy in Folding 1Password vault |
| Production Email Routing DNS and `support@getfolding.app` rule | `environments/production/` using `modules/support-email/` | Encrypted remote production state; applied November 7, 2026 |
| Existing verified forwarding destination | Account owner | Referenced only; not created or deleted by this project |

Credentials come from the persistent authorized shell, never committed files. Bootstrap creates only the private state bucket. Shared infrastructure applies require demonstrated remote locking and encrypted-backup restoration first. See `docs/technical/release-and-operations.md` for the full contract.

Provider lockfiles are committed. Plans, state, local backend metadata and credentials are ignored. Never disable state encryption, locking or `prevent_destroy` to work around an error.
