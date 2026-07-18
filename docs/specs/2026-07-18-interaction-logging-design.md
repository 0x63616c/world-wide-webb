# Interaction logging (human-attributable panel activity)

Status: **tiers A+B shipped**, **wake-photo session correlation shipped**
(plan `docs/superpowers/plans/2026-07-18-wake-photo-sessions.md`); tiers C–D
and the guards (§4.1–4.3) are still design.

Decisions taken since the first draft:

- Human-origin only (§7). Device-driven changes never reach the ui channel.
- The session boundary is now the **undim event**: `wake()` calls
  `startInteractionSession()`, which force-mints a fresh session (a physical
  approach outranks the 30s resume heuristic) and hands the id to the camera
  burst. The 60s inactivity timeout remains as a fallback for environments that
  never dim (browser, Storybook, `idleDimEnabled: false`). Known hole: a person
  arriving while the panel is already awake joins the previous session; fixing
  that needs a presence signal (HA motion), not more timing heuristics.
- Wake photos are indexed in Postgres (`wake_photo`, migration 0015): one row
  per frame with capturedAt, session id, device id, frame index; bytes stay on
  disk. The session reference is a plain column, not an FK — the photo lands
  over HTTP before the 3s-batched log ships the session it names. A boot-time
  idempotent backfill indexes pre-table photos (NULL on fields the old
  filename never carried). Retention: 90 days (`wake-photo-purge-service`),
  the first the photos ever had.
- Sessions are **derived, not stored** (`interaction-session-service`,
  `sessions.list` / `sessions.get`): aggregation over `frontend_log`
  `source='ui'`. No `interaction_session` table — the log's `session/start` /
  `session/end` entries carry every attribute a session has, and the shipper is
  idempotent with offline backfill; a second write path could drift.
- The viewer question (§7) resolved: a **Sessions mode** inside the existing
  `WakePhotoViewer` (third Segmented mode) — list of visits (photo thumbnail,
  start, duration, event count, end reason) → per-visit detail (burst frames +
  ordered transcript).

Goal: every human interaction with the wall panel lands in `frontend_log` so that
later we can reconstruct "a person walked up at 19:04, woke the panel, opened the
climate tile, nudged the thermostat to 20.5, and walked away". Today the log
tells us what the *machine* did, not what a *person* did.

Non-goal: identifying *who*. The panel has no per-user identity and this design
does not add one. "A person" is the subject.

---

## 1. What we have today

The pipeline is already built and healthy. Nothing in this design needs new
transport, storage, or retention work.

```
web/src/lib/log/  →  IndexedDB buffer  →  3s flush  →  batch(500)  →  tRPC logs.ingest  →  Postgres frontend_log
```

| Piece | Location | Notes |
| --- | --- | --- |
| Logger API | `web/src/lib/log/logger.ts:201-208` | `debug/info/warn/error`, `child(source)` |
| Entry shape | `web/src/lib/log/types.ts:22-68` | `id, seq, ts, sha, build, deviceName, level, source, msg, data, truncated` |
| Buffer caps | `web/src/lib/log/store.ts:63-64` | 1M entries / 1 GB |
| Shipping | `web/src/lib/log/ship.ts:40,46` | 500/batch, 10 batches per 3s tick |
| Auto-capture | `web/src/lib/log/capture.ts:54-103` | console, uncaught, rejections, online/offline |
| Ingest | `api/src/services/frontend-log-service.ts:79-119` | idempotent, PK `(deviceId, entryId)` |
| Table | `api/src/db/schema.ts:425-447` | indexes on `ts` and `(level, ts)` |
| Retention | `api/src/services/frontend-log-purge-service.ts:24` | 30 days, daily cron |

**No sampling, no rate limiting, no separate analytics stack.** Logging *is* the
telemetry. Good — one system to instrument.

### Current human-attributable coverage

Almost none. Exhaustive list of call sites that record something a person did:

| What | Where |
| --- | --- |
| Setting changed | `web/src/lib/settings.ts:207` |
| Settings reset | `web/src/lib/settings.ts:278` |
| Log export actions | `web/src/components/LogsModal.tsx:356-413` |
| Wake camera burst | `web/src/lib/wake-capture.ts:49-108` (device-triggered, implies a human) |

Everything else in the log is errors, fetch/tRPC/query traffic, boot, and
shipping internals. Tile taps, modal opens, pans, scrolls, control actuation,
idle/wake transitions — all invisible.

---

## 2. The gap

~60 interaction points across 22 files. There is **no central event bus**; the
app is prop-driven composition plus three `useSyncExternalStore` pub-sub stores.
That is deliberate (keeps tiles independently testable, Storybook-first) and
this design does not propose replacing it.

But it means "add a log line at every call site" is 60 edits and a permanent
maintenance tax. The design below instead finds the handful of places where one
edit covers many interactions, and uses the type system for the rest.

### Coverage tiers

| Tier | Surface | Single instrument point | Est. edits |
| --- | --- | --- | --- |
| **A. Free** | modal open/close | `lib/modal-open-store.ts:24` `emit()` | 1 |
| **A. Free** | any setting change | `lib/settings.ts:178` `emit()` | 1 |
| **A. Free** | layout editor open/close | `lib/layout-edit-store.ts:17` `emit()` | 1 |
| **B. Cheap** | tile tap (all 17 tiles) | `Board.tsx:755` `onTileClickCapture` | 1 |
| **B. Cheap** | nav / jump / recenter | `Board.tsx:620,646,658` | 3 |
| **B. Cheap** | wake, idle-dim, idle-reset | `Board.tsx:727` `wake()`, `useBoard.ts` idle hooks | ~4 |
| **C. Typed** | control actuation | `ui/ControlTap,Slider,Switch,Segmented` | 4 primitives + prop threading |
| **D. Summarized** | pan / scroll / drag gesture | `useBoard.ts` settle callbacks | ~2 |

Tiers A and B are ~11 edits and buy the majority of the value. Tier C is the one
that needs a real abstraction (§4). Tier D needs volume discipline (§5).

---

## 3. Proposal: a distinct interaction channel, not just more debug lines

Do **not** scatter `log.debug("tile tapped")` calls. Two reasons:

1. Queryability. "What did a person do" must be one SQL predicate, not a grep
   through fetch noise.
2. Shape. Freeform `msg` strings drift; we want to aggregate by target over time.

### 3.1 API

New module `web/src/lib/log/interaction.ts`, built on the existing logger:

```ts
export type InteractionSurface =
  | "tile" | "modal" | "control" | "nav" | "settings" | "gesture" | "session";

export type InteractionAction =
  | "tap" | "open" | "close" | "change" | "commit"
  | "pan" | "jump" | "recenter" | "wake" | "idle";

/** target is a stable dotted id, e.g. "tile_climate", "control.lamp.desk" */
export function interaction(
  surface: InteractionSurface,
  action: InteractionAction,
  target: string,
  detail?: Record<string, unknown>,
): void;
```

Emits at `info`, `source: "ui"`, so `where source = 'ui'` is the whole query. The
existing `MAX_DATA_CHARS` clamp (`logger.ts:36`) already protects `detail`.

### 3.2 Interaction sessions — the part that makes this readable

The panel is always on. Wall-clock timestamps alone give a soup of events with no
notion of "a visit". Bracket them:

- On `wake()` with no active session → open a session: new `interactionSessionId`
  (`isn_<id>`, per repo ID convention), log `session/wake`.
- Every interaction carries `interactionSessionId` + a monotonic `idx` in `data`.
- On idle-dim (or idle-reset, whichever fires first) → log `session/idle` with
  duration and event count, then clear the session.

Now "this is what a person did" is:

```sql
select ts, data->>'idx' as i, msg, data
from frontend_log
where source = 'ui' and data->>'interactionSessionId' = 'isn_...'
order by ts;
```

This is the single highest-value idea in the document. Without it the data is
present but tedious; with it, each visit is one readable transcript.

Open question: does a session survive a brief idle-dim, or is dim always a
session boundary? Proposed default — dim ends the session; a wake within 30s
resumes the previous `interactionSessionId` rather than minting a new one.

---

## 4. Systems so we can't forget to log

This is the durable half of the work. Ranked by strength.

### 4.1 Instrument inside the primitive, never at the call site (strongest)

`ControlTap`, `Switch`, `Slider`, `Segmented` are today dumb prop forwarders.
Move the logging *into* them. The caller supplies **identity only**; the
primitive emits the event.

```tsx
// before
<Switch checked={on} onChange={setOn} />
// after — logId is REQUIRED, not optional
<Switch logId="control.fan.bedroom" checked={on} onChange={setOn} />
```

Consequence: it becomes *impossible* to add an interactive control that does not
log, because the component you must use will not typecheck without a `logId`,
and it does the logging itself. There is nothing to remember.

Required, not optional, is the whole point. An optional field is a field that
gets skipped.

### 4.2 Ban raw handlers outside the primitives (lefthook guard)

4.1 only works if people actually use the primitives. Add
`scripts/check-interaction-logging.sh` following the exact shape of
`scripts/check-fake-data.sh:20-69` (grep + sanctioned-list + exit 1):

- Fail on `onClick=` / `onPointerDown=` / `onChange=` in
  `web/src/components/**` **outside** `components/ui/`.
- Sanctioned-list escape hatch for the legitimate exceptions (Board's capture
  handler, Modal's close, CleanScreenOverlay).

Wire into `lefthook.yml:3-62` (pre-commit, parallel with the 7 existing guards)
and mirror it in the CI test job (`ci.yml`) as the authoritative backstop — the
same dual-layer pattern already used for `check-storybook-docs`.

### 4.3 Registry-level requirement (tiles)

Add `logId: string` as a **required** field on `TileRegistryEntry`
(`lib/tile-registry.ts:73-98`). TypeScript blocks a new tile at edit time. Then
extend `components/tiles/__tests__/registry-guards.test.ts:42-76` — which already
asserts id format, bounds, overlap, home tile, and story coverage — with a
`logId` presence + uniqueness assertion. That test gates CI.

Arguably `logId` can just be derived from the existing `id` field, in which case
this reduces to a uniqueness assertion. Worth deciding before building.

### 4.4 Store-level interception (free total coverage)

For modals, settings, and layout-edit, patch the single `emit()` in each store.
Any future modal or setting is logged automatically the day it is added, with
zero author awareness required. This is why tier A is "free" — it's not just
cheap now, it's self-maintaining.

### 4.5 Storybook

Storybook-first is a repo rule and `addon-vitest` is already configured
(`.storybook/main.ts:11-17`). A play function can assert a control emits an
interaction event. Lower priority than 4.1–4.4 — Storybook tests don't gate CI
the way `registry-guards` does — but it's the natural place to prove the
primitives work.

---

## 5. Volume

Rough estimate per busy day: taps/modals/settings in the low hundreds, gestures
dominate. Against 1M entries / 1 GB local cap and 30-day retention, tiers A–C
are noise-level. Tier D is the only risk.

**Gesture rule: log on settle, never per-frame.** A pan emits *one* event at
`useBoardSnap` settle with `{ fromTile, toTile, distancePx, durationMs }`. Raw
`onPointerMove`/`onScroll`/`onWheel` at 60 Hz must never reach the logger —
that's ~3600 entries/minute of panning and would bury everything else.

If volume becomes a problem later, the lever is level-based: emit gestures at
`debug` and everything else at `info`, then filter server-side. Not needed at
the start.

---

## 6. Suggested build order

1. `lib/log/interaction.ts` + session bracketing (§3). Nothing to see yet, but
   everything else depends on the shape.
2. Tier A store `emit()` hooks (§4.4) — 3 edits, immediate real data.
3. Tier B Board handlers — tile tap, nav, wake/idle.
4. Tier C primitives with required `logId` (§4.1) + thread through call sites.
   This is the biggest single chunk of work.
5. Guards: lefthook script (§4.2) + `registry-guards` assertion (§4.3).
6. Tier D gesture-on-settle (§5).

Steps 1–3 are small and deliver most of the value; the "can't forget" machinery
lands in 4–5.

---

## 7. Open questions

- Session resume window on brief dim — 30s proposed, unvalidated.
- Derive tile `logId` from `id`, or make it independent?
- Do we want a `ui`-filtered view in `LogsModal` (panel-side transcript viewer),
  or is SQL enough?
- Should `interaction()` also fire for device-initiated state changes (HA pushes
  a light change), or strictly human-origin? Proposed: strictly human — device
  changes stay on the existing debug channel, otherwise "what a person did"
  stops meaning that.
