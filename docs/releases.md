# Latest panel release

The releases App stores the latest uploaded TestFlight build per app in Postgres.
`POST /api/releases/latest` accepts `{ "app": "panel", "build": 123 }` using the
existing `ALARM_API_TOKEN` bearer and Cloudflare Access kiosk service token. An
atomic conditional upsert only advances the build; equal and older retries leave
both the build and timestamp untouched. No new secret or deployment target exists.

Panel reads use Cloudflare Access alone, like the other panel queries:
`GET /api/releases/latest?app=panel` or `releases.latest({app: "panel"})` over tRPC.
Both return `{app, build, updatedAt}` or 404 before the first upload. Reads are not
cached. A build is a positive PostgreSQL integer; app IDs are bounded lowercase
identifiers. POST returns 503 when automation is unconfigured, 401 for bad bearer
credentials, and 400 for invalid input.

The native TestFlight workflow records the exact archive build after successful
upload. A failed recording warns without failing the upload. Recording can be
retried safely with the same build; never post an invented build to production.

Run the HTTP tests with `bunx vitest run features/releases/http.test.ts`.
Service tests use a real Postgres instance with an isolated disposable schema:
`RELEASES_TEST_DATABASE_URL=<local-test-url> bunx vitest run features/releases/service.test.ts`.
They cover persistence, independent apps, equal/older retries, concurrent unordered
uploads, and database constraints.
