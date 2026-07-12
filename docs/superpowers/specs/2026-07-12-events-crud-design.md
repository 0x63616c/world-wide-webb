# Events CRUD — Design

Date: 2026-07-12

## Goal

Let the user create, edit, and delete upcoming events end-to-end from the Events
tile's detail modal, and seed the real event lineup. Verify in production that
`events.list` returns > 0 items.

## Approach

Reuse the existing `events` table (`id, name, place, date, created_at`) unchanged.
`place` doubles as the optional **location** field (venue / city / street) — no
migration needed. `place` stays `NOT NULL`; the UI + input schema default it to
`""` so it is effectively optional to the user.

### Backend (`products/control-center/api`)

- `events-service.ts`: add `createEvent`, `updateEvent`, `deleteEvent`. Extend
  `EventRow` with `id` so the UI can target a row. Shared `toEventRow` maps a DB
  row → `{ id, name, place, days, date }` (computed `days`, ISO `date`).
- `zod-schemas.ts`: surface `id` in `EventSelectSchema`; add `EventInputSchema`
  (`name` required, `place` optional default `""`, `date` ISO string w/ offset).
- `events.ts` router: add `create` / `update` / `delete` mutations alongside
  `list`. `update`/`delete` take a positive-int `id`.

### Frontend (`products/control-center/web`)

- New pure view `EventsModalManage.tsx`: an add form + a list of existing events
  with inline edit and delete. All data + effects via props (`onCreate`,
  `onUpdate`, `onDelete`, `busy`); local state only for the form + which row is
  being edited. Storybook story covers populated / empty / busy / closed.
- Wiring `wiring/events.tsx`: add a fifth "Manage" variant that binds the three
  mutations and invalidates `events.list` on settle.

### Seed + verify

After deploy, create the real lineup through the live API (authenticated browser
session), then confirm `events.list` returns > 0.

## Non-goals

- No new DB column, no recurring events, no reminders/notifications.
- No changes to the four existing read-only variants beyond passing `id` through.
