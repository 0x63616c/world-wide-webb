# Walk log API (WWW-27)

Backend-only feature at `features/walks/`; no tile or changes to existing clients.
All six public procedures use plain tRPC v11 HTTP at `/trpc/walks.<procedure>`
with no transformer. Non-batched success envelopes are `{ "result": { "data": … } }`.
The JSON fixtures beside this document are synthetic full HTTP success responses,
verified by `apps/api/src/__tests__/walks-http.test.ts` for the WWW-28 Swift client.

## Contract

```ts
type Walk = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  source: "iphone" | "ipad" | "web" | "unknown";
  createdAt: string;
  updatedAt: string;
};
type State = { active: Walk | null; updatedAt: string; serverTime: string };
```

All output dates are ISO-8601 UTC with milliseconds. Input dates must include
`Z` or an explicit UTC offset; outputs normalize offsets to UTC. Omitted start
and stop dates use server time after acquiring the mutation lock. Clients may
use `serverTime` for clock skew and calculate elapsed time from `active.startedAt`.
State queries use indexed lookups and can be polled every five seconds.

| Procedure | HTTP | Input | Result data |
| --- | --- | --- | --- |
| `walks.state` | GET | none | `State` |
| `walks.history` | GET | `{ limit?: number, before?: string }` (optional object) | `{ walks: Walk[] }` |
| `walks.start` | POST | `{ id?: string, startedAt?: string, source?: Walk["source"] }` (optional object) | `State` |
| `walks.stop` | POST | `{ id: string, endedAt?: string }` | `State` |
| `walks.delete` | POST | `{ id: string }` | `State` |
| `walks.update` | POST | `{ id: string, startedAt?: string, endedAt?: string }` | `State` |

- `history.limit` defaults to 50 and must be an integer from 1 to 500. Only
  completed, undeleted walks appear, ordered by `startedAt` descending, then ID
  descending. `before` is an exclusive `startedAt` boundary: use the last result's
  `startedAt` for the next page. Equal timestamps are all excluded by that
  boundary; the timestamp-only API cannot resume inside a group of equal start
  times. An omitted input object is equivalent to `{}`.
- `start.id`, when supplied, must be a UUID. Server-generated IDs use
  `genId("walk")`; clients must treat all returned IDs as opaque strings.
  Other procedures accept nonempty IDs up to 128 characters. `source` defaults
  to `unknown` and is recorded only when creating a walk.
- Starting while any walk is active returns that walk unchanged. A retry with
  an existing ID never creates another walk, including after completion or
  deletion. An ID submitted while another walk was active is not reserved.
- Stop changes only an active, undeleted matching walk. Repeated stops preserve
  the original end time and revision. An end before the start clamps to the
  start. Unknown/deleted IDs are successful no-ops for stop and delete.
- Update preserves omitted fields, can complete an active walk, and cannot
  reopen a completed walk (`endedAt` cannot be null). It validates the resulting
  pair of dates and returns `BAD_REQUEST` if the end precedes the start.
  Missing/deleted IDs return `NOT_FOUND`. An empty update is a no-op.
- Delete removes a walk from both active state and history. Internal tombstones
  retain the consumed ID and deletion revision; no personal data is stored.
- State `updatedAt` is the latest persisted modification time, including
  deletes, or `1970-01-01T00:00:00.000Z` for an empty log. It stays unchanged on
  no-op start/stop/delete. `serverTime` is refreshed on every state response.
  Timestamps have millisecond wire precision; use polling to refresh rather
  than assuming that every mutation has a unique timestamp.

GET inputs are ordinary JSON encoded in the `input` query parameter. POST
inputs are ordinary JSON request bodies with `Content-Type: application/json`.
For example, `POST /trpc/walks.start` with `{ "source": "iphone" }`.
Standard tRPC errors apply (`BAD_REQUEST` for invalid input).

## Migration and verification

`0042_careful_mercury.sql` was generated using `bun run --cwd apps/api db:generate`
after `bun run apps:gen`. It only adds `walk`, its date/source checks, a partial
unique index on a constant for undeleted active walks, and history/revision
indexes. Existing tables and procedures are unchanged. API/worker startup runs
the existing migration runner; no backfill is needed. Mutations and state
snapshots share a transaction-scoped Postgres advisory lock across replicas.

```sh
source .job.env
bun run lint
bun run typecheck
bun run test
WALKS_TEST_DATABASE_URL=postgresql://localhost/test_db bun run test -- features/walks
```

The Postgres tests use a unique temporary schema, execute the generated
migration, and drop that schema afterward. They are opt-in like the existing
alarm integration tests; ordinary CI runs the validation and HTTP fixture tests.
Local verification also ran all Postgres tests against an isolated Postgres 17
instance, including concurrent starts and direct index/check enforcement.

Not merged: merging deploys prod; needs Calum's OK
