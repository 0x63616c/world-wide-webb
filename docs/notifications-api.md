# Notifications API (WWW-58)

The `notifications` feature owns a durable, shared notification inbox. All
panel devices see the same read and dismissal state. These endpoints are additive;
existing endpoints and request/response contracts are unchanged. The Swift client
in WWW-59 can use plain JSON HTTP and SSE without a tRPC dependency.

## Access and transport

Base URL: the panel's existing origin, e.g. `https://app.worldwidewebb.co`.
Like existing panel tRPC and media endpoints, these routes rely on the existing
network/Cloudflare perimeter, with no additional bearer token or server PIN
check (ADR-0004). They are panel endpoints, not a public webhook ingress.
Send JSON bodies with `Content-Type: application/json`. Responses use
`Cache-Control: no-store`. nginx and the Vite dev server proxy this new path.
No credentials or notification payloads are logged by the feature.

## Create and row shape

`POST /api/notifications`

```json
{
  "source_module": "alarms",
  "title": "Morning alarm",
  "body": "Time to get up",
  "deep_link": "module/events/alarms",
  "priority": "high",
  "dedupe_key": "morning"
}
```

Fields:

| Field | Contract |
| --- | --- |
| `source_module` | Required; `^[a-z][a-z0-9_-]{0,63}$` (feature identifier). |
| `title` | Required string; trimmed, 1–200 characters after trim. |
| `body` | Required string, 0–4000 characters. Plain text. |
| `deep_link` | Required string, max 512 characters; `module/<id>[/path]`. Each segment contains only ASCII letters, digits, `_` or `-`; no empty segments, query, fragment, URL scheme, trailing slash or traversal. This is a route identifier, not an external URL. Client resolves the module and optional path; unknown modules should leave the inbox usable. |
| `priority` | `low` \| `normal` \| `high` \| `critical`; optional, defaults to `normal`. No automatic side effects or priority-based ordering on the server. |
| `dedupe_key` | Optional string, 1–200 characters, or null; omitted defaults to null. Null disables dedupe. |

Returns **201**, including when dedupe updates an existing row. All create/read/
dismiss responses return the same full row shape:

```json
{
  "id": "ntf_0123456789abcdef0123456789abcdef",
  "source_module": "alarms",
  "title": "Morning alarm",
  "body": "Time to get up",
  "deep_link": "module/events/alarms",
  "priority": "high",
  "dedupe_key": "morning",
  "created_at": "2026-10-30T12:00:00.000Z",
  "updated_at": "2026-10-30T12:00:00.000Z",
  "read_at": null,
  "dismissed_at": null,
  "revision": "1"
}
```

IDs are opaque `ntf_` identifiers. All timestamps are UTC ISO 8601 strings;
`read_at` and `dismissed_at` are nullable. `revision` is a decimal **string**,
not a JSON number (safe for the entire Postgres bigint range).

Dedupe window = the entire time the row remains undismissed, with no elapsed-time
expiry. Same `(source_module, dedupe_key)` updates the existing ID with the new
payload, bumps `created_at` and `updated_at`, assigns a new revision and resets
`read_at` to null. A dismissed match is never revived: create inserts a new ID.
A partial unique index arbitrates concurrent creates; different sources never
collide. Unknown object fields are stripped by Zod.

## List and polling

`GET /api/notifications?unread=true&since=0&limit=100`

All query parameters are optional:

| Parameter | Contract |
| --- | --- |
| `unread` | Literal `true` for unread, undismissed rows; literal `false` for read rows; omit for either. |
| `since` | Opaque decimal revision cursor (string, `0` through `9223372036854775807`). Exclusive. Not a timestamp. |
| `limit` | Integer 1–200, defaults to 100. |

Response **200**:

```json
{
  "items": [],
  "cursor": "0",
  "has_more": false
}
```

`items` contains full rows in ascending revision order. Without `since`, only
undismissed rows are listed. With `since`, changed rows include dismissed rows
(tombstones), so clients can remove them from their local inbox. `unread=false`
with `since` may therefore include read, dismissed rows. `cursor` is the last
returned revision, or the input cursor (or `"0"`) when no items were returned.
When `has_more=true`, immediately fetch the next page using `since=cursor`.
Otherwise save the cursor and poll again later (suggested fallback: 5 seconds).
Sort the displayed inbox by `created_at` if newest-first presentation is wanted.

For a synchronized local inbox, omit `unread`, upsert each row by `id`, and remove
rows with `dismissed_at != null`. Filter unread locally: a filtered feed cannot
deliver a row when it changes out of that filter. Start with GET without `since`,
drain pages, then connect SSE with the returned cursor. The first SSE connection
can also initialize the inbox without GET. This is a current-state feed, not an
immutable event log: multiple changes to one row between polls coalesce to its
latest state. Clients offline for 30 days should discard their cache and do a
fresh unfiltered initial fetch, since dismissal tombstones may have expired.

## Read and dismiss

| Endpoint | JSON request | Success |
| --- | --- | --- |
| `POST /api/notifications/read` | `{ "id": "ntf_…" }` | 200 full row with `read_at` set. |
| `POST /api/notifications/dismiss` | `{ "id": "ntf_…" }` | 200 full row with `dismissed_at` set. Does not implicitly mark read. |
| `POST /api/notifications/dismiss-all` | No body required. | 200 `{ "dismissed": 3 }` (number changed). |

Repeated read/dismiss calls preserve the original action timestamp and assign a
new revision/updated timestamp. Dismiss-all touches only undismissed rows.
Read/dismiss for an unknown ID returns **404**
`{ "error": "Notification not found" }`. An already dismissed row is still
addressable until retention removes it. There is no hard-delete endpoint.

Invalid input (including malformed JSON, missing JSON content type, or create/
action bodies over 32768 bytes) returns **400**:

```json
{
  "error": "Invalid notification request",
  "issues": [{ "path": ["title"], "message": "…" }]
}
```

`issues` is an array of Zod paths/messages; messages are descriptive, not stable
machine error codes. Storage failures are server errors, never success responses.

## SSE live delivery

`GET /api/notifications/stream?since=<cursor>` returns
`Content-Type: text/event-stream`. Optional `Last-Event-ID: <cursor>` takes
precedence over the query parameter on reconnect. The cursor has the same
validation and semantics as GET. No `unread` filter applies to SSE.

```text
id: 42
event: notifications
data: {"items":[],"cursor":"42","has_more":false}

```

Each `notifications` event contains the exact list envelope above, with up to
200 full rows. Apply all items before saving its SSE ID/cursor. The first event
is always emitted (even for an empty page); pages with more data drain immediately.
A connection polls Postgres once per second while caught up, pushing changes
from any API/worker process, and sends `: heartbeat` comments when idle. Thus
normal delivery latency is about one second plus network time. Slow consumers
have pull-based backpressure with a single page buffered.

Streams close after about 55 seconds; reconnect with the last successfully
applied event ID. Browser EventSource handles reconnect automatically; native
clients must reconnect with backoff or poll GET using that cursor on stream or
network failure. nginx disables buffering/cache/compression on the new path.
Aborted requests and cancelled readers stop the polling loop.

A transaction-scoped Postgres advisory lock (key `580058`) serializes notification
mutations and list snapshots across processes. Revisions are allocated inside
that lock and committed before a reader can advance, preventing a slow commit
from appearing behind an already consumed cursor. Sequence gaps are expected.
Use the service helper for all writes, never direct SQL inserts/updates: direct
writers would bypass this ordering guarantee.

## Server and tRPC integration

```ts
import { createNotification } from "@features/notifications/service";

await createNotification({
  source_module: "walks",
  title: "Walk complete",
  body: "The walk is ready to review",
  deep_link: "module/walks",
  priority: "normal",
  dedupe_key: "walk-complete",
});
```

The helper validates the same input, returns the full JSON-safe row, and resolves
only after commit. It is available to backend features without an HTTP roundtrip.
This slice does not automatically add notification producers to existing modules.

Equivalent additive tRPC procedures: `notifications.create` (create body),
`notifications.list` (object with the GET parameter shapes, `limit` accepts a
number), `notifications.read`/`notifications.dismiss` (`{id}`), and
`notifications.dismissAll` (no input). List requires an object, `{}` for defaults.
Outputs match REST; invalid input uses tRPC BAD_REQUEST and missing IDs NOT_FOUND.
SSE is HTTP only. Generated router/schema/HTTP/worker registries include the feature.

## Migration and retention

`0044_daffy_blonde_phantom.sql` creates only the new `notifications` table,
`notification_revision` sequence, priority check, active-dedupe partial unique
index, revision index and dismissed-at retention index. Existing tables, columns
and endpoints are untouched. API/worker run the normal Drizzle migrations at boot.
No backfill or new secret is required. Rollback can run the old application while
leaving the additive objects in place.

The feature's `notifications-prune` worker runs at startup and hourly, deleting
only rows whose `dismissed_at` is more than 30 days old. Undismissed rows are kept.
Retention uses dismissal time, so a recently dismissed old notification remains
available as a tombstone for the full 30 days.

## Verification

Run the feature tests with an isolated Postgres database to exercise concurrency,
commit/cursor ordering, pagination, dedupe windows, filters and retention:

```sh
NOTIFICATIONS_TEST_DATABASE_URL=postgresql://localhost/notifications_test bun run test features/notifications
bun run test
bun run typecheck
bun run lint
bun run apps:check
bun run knip
```

The Postgres tests create and drop their own generated schema and are skipped
unless that test URL is supplied. HTTP, tRPC, validation and SSE lifecycle tests
run without a database. All fixtures are synthetic.
