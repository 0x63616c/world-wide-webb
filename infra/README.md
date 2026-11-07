# Infrastructure ownership

OpenTofu owns durable Cloudflare resources. Wrangler owns Worker code versions, generated bindings and D1 migrations; it must not recreate resources managed here.

| Resource | Owner | State |
| --- | --- | --- |
| Private `folding-infrastructure-state` R2 bucket | `bootstrap/` OpenTofu root | Encrypted bootstrap state, recovery copy in Folding 1Password vault |
| Production Email Routing DNS and `support@getfolding.app` rule | `environments/production/` using `modules/support-email/` | Encrypted remote production state; applied November 7, 2026 |
| Application D1, private avatar R2, jobs/dead queues | Each environment root using `modules/application/` | Defined; deployment evidence recorded separately |
| Admin Access application and email allowlist | Same application module | Explicit allowlist, one-hour sessions |
| API/admin DNS and Worker routes | Same application module | Disabled until compatible Worker code exists |
| Existing verified forwarding destination | Account owner | Referenced only; not created or deleted by this project |

Credentials come from the persistent authorized shell, never committed files. Bootstrap creates only the private state bucket. Shared infrastructure applies require demonstrated remote locking and encrypted-backup restoration first. See `docs/technical/release-and-operations.md` for the full contract.

Provider lockfiles are committed. Plans, state, local backend metadata and credentials are ignored. Never disable state encryption, locking or `prevent_destroy` to work around an error.

Generate code bindings after a successful apply with `tofu output -json application_bindings | python3 scripts/generate-worker-config.py --configuration /path/to/public-runtime-config.json --output /path/to/wrangler.json`. The generator requires the exact Git commit and explicit Apple build allowlist, includes no credentials, disables public preview URLs, and initializes accepted capabilities to empty. Install runtime secrets separately. Queue consumers are added only once the Rust handler is implemented.
