# __NAME__ backend

Cloudflare Worker owned by this app. Run `bun install --frozen-lockfile`, `bun run check`
and `bun run dev` here. The check runs route tests and bundles both environments without
publishing. `/healthz` reports the environment and configured release revision.

Staging and production have separate Worker names. Public workers.dev routes and preview URLs
start disabled. The scaffold does not provision an account, domain, database or credentials.
Use a product-scoped Cloudflare API token in the approved secret store and release environment.
Never put an operator token or application secret in the app bundle or Git.

Before publishing a real API, implement its user authentication/authorization, bounded input,
rate and cost limits, errors and offline behavior. Add D1/R2/Queues only when the product needs
them; declare separate bindings for each environment, version database migrations and test
compatibility before promotion. Keep account resources under `infra/cloudflare`, with one state
owner and imports for existing resources. Access protects operator surfaces; product users need
the product's own authorization model.

For first delivery, the agent configures the actual account/domain and credentials, runs the
staging Worker in workerd, tests health and the real app journey, then wires exact successful
main CI source/artifact promotion to production using the existing release process. Set
`RELEASE_REVISION` to the tested source SHA. Record the immutable Worker version and verify the
live response; rollback to the last tested compatible version without rolling back user data.
The generated CI verifies this backend but does not automatically publish it. Do not enable an
app's distribution channel until its own signed/processed beta and backend acceptance pass.

Wrangler configuration and environment details: https://developers.cloudflare.com/workers/wrangler/configuration/
