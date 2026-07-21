# Flat ISO-8601 photo paths

Date: 2026-07-21

## Problem

Booth and wake photos are stored under three levels of date nesting with an
epoch-millisecond filename:

```
<MEDIA_STORAGE_DIR>/booth-photos/2026/06/01/1784516886155-0.jpg
<MEDIA_STORAGE_DIR>/wake-photos/2026/07/20/1752849600000-0.jpg
```

Two things are wrong with it, both about humans reading the store directly:

- Three clicks to reach any photo, and the intermediate segments (`06`, `01`)
  carry no meaning on their own.
- `1784516886155` is not a date to anyone. The only readable timestamp format is
  ISO 8601.

## Layout

One directory per kind. No date nesting. The filename is the full capture
instant in UTC.

```
<MEDIA_STORAGE_DIR>/booth-photos/2026-06-01T14-28-06.155Z-0.jpg
<MEDIA_STORAGE_DIR>/wake-photos/2026-07-20T00-31-00.134Z-0.jpg
```

Format: `<instant>-<n>.<ext>` where

- `<instant>` is the ISO 8601 UTC instant with `:` replaced by `-`
  (`2026-06-01T14-28-06.155Z`). Milliseconds are always present, `Z` is always
  present, so every name is fixed-width and name-sort equals time-sort.
- `<n>` is the existing same-millisecond collision counter, semantics unchanged
  (see below).
- `<ext>` is `jpg` for wake photos, `jpg` or `gif` for booth photos, sniffed
  from the bytes exactly as today.

### Why no colons

Real ISO 8601 extended format writes `14:28:06`. `:` is illegal on SMB and
exFAT, and macOS Finder renders it as `/`. The store is browsed over SMB, so
colons are out. ISO 8601 *basic* format (`20260601T142806Z`) is legal and
conformant but is the unreadable form the whole change is trying to escape.
Dashes for colons keeps it readable at the cost of strict conformance.

### Why UTC

Unambiguous, no DST gap or repeat, name-sort is always chronological. The cost
is that a 23:00–24:00 local capture under BST files under the next day's date.
That is accepted: `captured_at` is `timestamptz` in Postgres and every UI
renders local time from the column, never from the path. The path is an
address, not a display value.

### Why flat

Serving a photo is a named lookup (`GET /media/<kind>-photos/<path>` →
`open()`), which ext4's htree resolves in roughly constant time at any directory
size. Nothing on the hot path degrades. The one per-upload directory scan is
removed by this change (see below), so no write path is linear in directory size
either.

Flat and sharded are mutually reachable with a `mv` pass plus a `path` column
rewrite, in both directions, *because every filename carries its own full
instant*. The filename is the durable decision; the directory is not.

## The collision counter stays a collision counter

`-<n>` is currently the count of files already on disk sharing that
millisecond — `booth-photo-service.ts:186` and `wake-photo-service.ts:101`. It
is **not** a frame index. `wake_photo.frame_idx` exists as a real column and is
nullable precisely because backfilled rows never had one; the schema comment
says so explicitly.

So the suffix keeps its meaning. What changes is how it is computed:

- **Today:** `readdir(dayDir)` then filter by timestamp prefix. Bounded by the
  day's file count, which a flat directory would turn into the whole store.
- **After:** try `-0`; on `EEXIST` try `-1`, and so on. A `stat`-shaped probe
  that terminates on the first free slot, which is the first attempt in every
  non-colliding case.

This removes the only directory-size-dependent operation in the write path,
which is what makes flat safe.

## Migration

155 rows in prod at time of writing (75 wake, 80 booth), roughly two days of
data, plus any on-disk files that predate the index tables.

The rename is **bijective**: the new name is derived from the old name's epoch
alone, and the collision suffix is carried across verbatim. Two files that were
distinct before are distinct after, so no dedup or renumbering is needed.

```
2026/06/01/1784516886155-0.jpg  ->  2026-06-01T14-28-06.155Z-0.jpg
```

Steps, run as a one-shot in-cluster (the NFS `/app/media` mount exists only in
the pod):

1. For each `wake_photo` / `booth_photo` row: compute the new path from
   `captured_at` and the old suffix, `rename()` on disk, then `UPDATE` the row.
   **File first, row second** — the reverse order points a live row at bytes
   that are not there yet, which 404s in the gallery. This matches the ordering
   rationale already documented on `saveWakePhoto`.
2. Walk the tree for files with no row (wake photos predating the index), parse
   their epoch prefix, and rename them the same way.
3. Remove the emptied `YYYY/MM/DD` directories.

Idempotent: a path already in the new shape is skipped, so a partial run can be
re-run.

## Blast radius

Verified against the codebase, not assumed:

**Safe.** The web treats `path` as an opaque string — `BoothGallery`,
`WakesTileView` and `SessionDetailView` pass it straight to `photoUrl()`, and
nothing splits it or reads a date out of it. The serve routes
(`server.ts:163`, `server.ts:241`) are prefix-strip plus root-join with a
traversal guard, with no assumption about the shape between. `path` is
`wake_photo`'s primary key and `booth_photo`'s unique key but nothing foreign-keys
to it. `photoPaths` on a session is derived at read time by a join
(`interaction-session-service.ts:144`), never stored. There is no service worker
in `web/public/`, so there are no cached image URLs to invalidate.

**Must change: `walkPhotoFiles`.** It runs on every api boot via
`backfillWakePhotoIndex` (`server.ts:48`). It hardcodes three levels of
`readdir` and parses the timestamp as `Number(f.split("-")[0])`.

Left alone, its nested `readdir` calls fall into `.catch(() => [])` and it
silently indexes nothing — a dead safety net, no crash.

Rewritten carelessly, it is destructive. On a new-format name:

```
Number("2026-06-01T14-28-06.155Z-0.jpg".split("-")[0])  // -> 2026
```

`2026` passes the `Number.isFinite` guard, so every photo would be indexed at
`captured_at` = 1970-01-01T00:00:02.026Z. That is 56 years past the 90-day
wake-photo retention cutoff, so the next nightly `portal-data-purge` run would
delete the rows and unlink the files. Real photo loss, one cron tick later.

The old format was epoch-first, so `split("-")[0]` was the entire timestamp; the
new format is dash-delimited *inside* the timestamp. Same expression, silently
different meaning, no type error.

Mitigation: rewrite as a single-level scan that parses the full ISO instant, and
reject any parse landing before 2020 rather than trusting `Number.isFinite`. A
test feeds it a new-format name and asserts the exact instant.

**Mechanical.** 13 hardcoded `YYYY/MM/DD/` fixture paths across tests and
stories.

## Retention is unchanged

Wake photos keep their 90-day purge (`wake-photo-purge-service.ts`, run from the
daily `portal-data-purge` CronJob, cutting on `captured_at`). Booth photos keep
having no purge — they are deliberate captures with a reversible soft delete.
Neither reads a path shape, so neither changes.

## Code shape

The date-directory helper is currently duplicated as a private `dayDirFor` in
both services. It is replaced by one module, `api/src/services/media-path.ts`,
owning the whole format in both directions:

- `photoFileName(capturedAt, n, ext)` — build a name.
- `parsePhotoFileName(name)` — recover the instant, or `null` if the name is not
  in the new shape.

Both services and the migration use it, so the format is defined once. It stays
inside the control-center api rather than `packages/platform` because nothing
outside this product stores photos.
