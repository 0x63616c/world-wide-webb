# Remove Notification Dismiss Feature

**Date:** 2026-07-20
**Status:** Approved, ready for planning

## Goal

Remove the "dismiss" concept from the notification feed entirely. The feed
keeps only two lifecycle states: **unread** and **read**. The UI keeps two
tabs — **Unread** and **All** — and drops the **Dismissed** tab.

The user never dismisses notifications, so the archive tab, the dismiss action,
and the `dismissed_at` storage are dead weight. Full removal, including the DB
column — no dead columns left behind.

## Non-goals

- The separate local-banner "dismiss" UX (`AppUpdateBanner`, `DeviceNameBanner`,
  `Modal`, `NotificationsPage.tsx` `clearNotification`, etc.) is a different
  concept and is **not touched**.
- No change to the read lifecycle (`read_at`), mark-as-read behavior, or the
  notify job's core purpose.

## End state

- Notification lifecycle stamps: `read_at` only. A notification is **unread**
  when `read_at is null`, otherwise **read**.
- Filter values: `"unread"` and `"all"`. No `"dismissed"`.
- No `dismiss` tRPC mutation, no `dismiss()` service function.
- No `dismissed_at` column; unread partial index predicated on `read_at is null`
  only.

## Changes by layer

### Schema (`api/src/db`)

- `schema.ts:652` — remove `dismissedAt` column.
- `schema.ts:663` — rebuild `notification_unread_idx` predicate to
  `WHERE read_at is null` (drop `and dismissed_at is null`).
- `schema.ts:637-639` — remove the read-vs-dismissed lifecycle comment.
- Generate a new migration via `bun run db:generate` that:
  - `DROP COLUMN dismissed_at` on `notification`.
  - Drops and recreates `notification_unread_idx` with the new predicate.
- `bunx biome format --write` the generated migration meta dir before committing
  (drizzle meta JSON fails lint otherwise).

### API (`api/src/services/notification-service.ts`, `trpc/routers/notifications.ts`)

- Remove `dismiss` import + the `dismiss` mutation (`notifications.ts:10,46-49`).
- `notification-service.ts`:
  - `notificationFilterSchema` → `z.enum(["all","unread"])` (drop `"dismissed"`).
  - Remove `dismissedAt` from `notificationItemSchema` and the list row mapping.
  - `raiseNotification` — drop the `dismissedAt: null` re-raise reset.
  - `countUnread` — predicate becomes `readAt IS NULL` only.
  - `listNotifications` — remove the `dismissed` filter branch and the
    exclude-dismissed clause; `all` = every row, `unread` = `read_at is null`.
  - Delete the `dismiss(db, id)` function.
  - notify job (`~329-332`) — skip only already-read rows.
  - Update stale comments referencing dismissed.

### Web (`web/src/...`)

- `lib/notifications.ts`:
  - `NOTIFICATION_FILTERS = ["unread","all"]`; update `NotificationFilter` type.
  - Remove `dismissedAt` from `NotificationItem`.
  - Remove `EMPTY_COPY.dismissed`.
  - `isUnread` → `!n.readAt`.
  - Delete `isDismissed()`.
- `components/tiles/modals/ExpandedNotificationCenterModalView.tsx`:
  - Remove the `{ value: "dismissed", label: "Dismissed" }` tab entry.
  - Remove the `Dismiss` `RowAction` and the `onDismiss` prop threading
    (panel → list → row).
  - Remove `const dismissed = Boolean(item.dismissedAt)` and its opacity styling.
- `components/tiles/detail/wiring/notifications.tsx`:
  - Remove `dismissMutation` and the `onDismiss` wire.

### Tests

- `web/src/lib/__tests__/notifications.test.ts` — drop `isDismissed` import and
  its describe/cases; keep unread/read coverage.
- `api/src/__tests__/notification-service.test.ts` — remove `dismiss` import,
  `dismissedAt` fixtures/assertions, the "serves the dismissed archive" test,
  the "read / dismiss lifecycle" dismiss cases, and the
  `"notifications.dismiss"` route-exists assertion. Keep read-lifecycle and
  filter coverage for `all`/`unread`.

## Verification

- `bun run typecheck` clean.
- `bun run test` — notification web + api suites green.
- `bun run lint` clean (incl. formatted migration meta).
- Migration applies against a DB that has the column.

## Risks

- Destructive migration: `dismissed_at` data is discarded. Acceptable — feature
  unused, user never dismisses.
- Any in-flight rows currently dismissed will reappear in `all` (and in `unread`
  if also unread). Expected and acceptable.
