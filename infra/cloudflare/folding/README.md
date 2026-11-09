# Infrastructure ownership

OpenTofu owns durable Cloudflare resources. Wrangler owns Worker code versions, generated bindings and D1 migrations; it must not recreate resources managed here.

| Resource | Owner | State |
| --- | --- | --- |
| Private `folding-infrastructure-state` R2 bucket | `bootstrap/` OpenTofu root | Encrypted bootstrap state, recovery copy in Folding 1Password vault |
| Production Email Routing DNS and `support@getfolding.app` rule | `production/` using `modules/support-email/` | Encrypted remote production state; applied November 7, 2026 |
| Application D1, private avatar R2, jobs/dead queues | Each environment root using `modules/application/` | Applied in both environments November 7; issue #32 records evidence |
| Admin Access application and email allowlist | Same application module | Applied in both environments; explicit allowlist, one-hour sessions |
| API/admin DNS and Worker routes | Same application module | Disabled until compatible Worker code exists |
| Existing verified forwarding destination | Account owner | Referenced only; not created or deleted by this project |

Credentials come from the persistent authorized shell, never committed files. Bootstrap owns the private state bucket and the owner-operated deployment identity. Shared infrastructure applies require demonstrated remote locking and encrypted-backup restoration first. See [release and operations](../../../apps/folding/docs/technical/release-and-operations.md) for the full contract.

Provider lockfiles are committed. Plans, state, local backend metadata and credentials are ignored. Never disable state encryption, locking or `prevent_destroy` to work around an error.

Generate code bindings after a successful apply with `tofu -chdir=infra/cloudflare/folding/production output -json application_bindings | python3 apps/folding/scripts/generate-worker-config.py --configuration /path/to/public-runtime-config.json --output /path/to/wrangler.json`. The generator requires the exact Git commit and explicit Apple build allowlist, includes no credentials, disables public preview URLs, and initializes accepted capabilities to empty. Install runtime secrets separately. The jobs queue is bound to the Rust queue handler with ten-message batches, concurrency two and bounded retries and its separate dead-letter queue. The dead-letter queue has no ordinary consumer.

The public runtime input contains exactly `APPLE_SIGN_IN_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APP_ATTEST_ENVIRONMENT`, `APP_ATTEST_BUNDLE_VERSIONS` (a JSON array encoded as a string), `ACCESS_TEAM_DOMAIN`, `WORKER_VERSION`, `ADMIN_EMAIL_ALLOWLIST` (a JSON array encoded as a string), and `APNS_KEY_ID`. Both environments use Production APNs for distribution/TestFlight builds, with the topic derived from the environment's bundle identifier. Notification delivery, avatar uploads and optional admin email start disabled pending their acceptance checks. Apple key IDs and vault recovery references are recorded in `docs/experiments/apple-account-bootstrap.md`; private keys are installed as secret bindings, never included in this input.

The bootstrap root also owns `cloudflare_account_token.deployment`. Its token-minter provider receives `TF_VAR_token_minter` only in the primary authorized shell. The generated owner-operated deployment token is in 1Password item `6plik7nl5z2uxc477uua344hdq`; it is not a CI identity. Service permissions are account-scoped where Cloudflare requires that granularity; DNS/routes/email are restricted to the getfolding.app zone. Do not reuse it for untrusted jobs. Bootstrap state recovery document was refreshed after token creation. Staging state key: `5v2cq5dof2mh4hnk7uus3racoa`.


## Application delivery credentials

`bootstrap/ci-identities.tf` defines separate WWW deployment and published-build policy
identities. This source is preparation until its reviewed encrypted plan is applied and the
credentials are saved in the approved vault and corresponding GitHub secrets. The owner-operated
infrastructure token remains separate.

The deploy identity edits existing Workers, applies checksum-fenced D1 migrations and configures
Queue consumers. Its route permissions cover only the Folding zone; it has no DNS, Access or
infrastructure-state storage permissions. The policy identity reads Worker deployment/version
metadata and writes the immutable D1 published-build ledger; it cannot deploy Workers. Workers,
D1 and Queue permissions use account-level product scopes, so these are trusted main delivery
credentials, never pull-request job credentials. A Worker binding alone requires no R2 data token.
Existing tokens and the encrypted state bucket retain `prevent_destroy`.

Recover the encrypted bootstrap state/key from the existing Folding vault, retain an encrypted
before-copy, and require a plan containing only the two named token creates. Do not initialize an
empty replacement state or reuse the owner identity in CI. Save the updated encrypted state back
to its existing recovery document before activating delivery. Runtime configuration remains
source-bound: preserve live flags, resources and accepted claims and use the existing staging
acceptance/readiness generator for changed backend inputs.
