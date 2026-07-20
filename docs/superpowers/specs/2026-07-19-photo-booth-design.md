# Photo Booth — Design Spec

Date: 2026-07-19. Status: approved decisions from multi-round Storybook design review.

## Summary

New "Photo booth" feature for the wall panel (`products/control-center/web`, fixed
1366x1024 kiosk). A board tile opens a fullscreen camera; photos taken in the app are
stored server-side and browsable in a gallery. Entirely separate from wake/access-log
photos (own table, own storage dir, own router).

## Locked design picks (Storybook prototypes)

- **Tile**: `photo-booth-designs/tile/MinimalMarkV2B.tsx` — 1x1, camera glyph + status dot.
- **Camera**: `photo-booth-designs/camera/ApertureV3.tsx` — user-approved final:
  - Timer: single button cycling Off→1s→3s→5s→10s. Off = round icon-only grayed
    (`--ink-3`); armed = amber capsule, timer icon left of value. No menu.
  - Top-right cluster left→right: filter trigger (colour-dot icon), timer, flash
    (outermost). Flash default off, amber when armed, ZapOff/Zap glyphs.
  - Filters: icon-only trigger opens house `Modal` swatch grid (7 CSS filters in
    `camera/camera-shared.ts`).
  - Modes via house `Segmented`: Photo / Burst / 4-Frame / GIF / Video (disabled,
    "soon"). Bottom cluster lifted off edge. Gallery button bottom-left.
  - No zoom features (dropped for v1).
- **Gallery**: `photo-booth-designs/gallery/GalleryDesign10.tsx` — "Minimal Squares".
  Edge-to-edge uniform square grid, oversized bold date headers, mode as tinted dot,
  quiet typographic lightbox with share + delete.
- **Lightbox layout** (user-specified 2026-07-19): Delete button top-left; photo date
  on the left; `‹` / `›` prev/next buttons flanking the image (navigate the whole roll
  in time order); Share bottom-right; close by tapping anywhere outside the image
  (backdrop) or Escape — no dedicated close button.

## New requirement: shared sticky page header

The gallery's "‹ Photos" header must stay pinned while the grid scrolls. This becomes a
**shared component** (`products/control-center/web/src/components/ui/`), e.g.
`PageHeader`: back button + title (+ optional right-side slot, e.g. photo count).

- Extract from the inline header in `components/tiles/detail/TileDetailHost.tsx:140`
  (BackButton + h1 row) — TileDetailHost adopts `PageHeader` so every tile detail page
  keeps the pinned-header pattern through one component.
- Pattern: page = flex column; header `flexShrink: 0`; single scroll region
  `flex: 1; minHeight: 0; overflow-y: auto` below. Header never scrolls away.
- Gallery and any future fullscreen page following back-button+title use it.

## Feature behavior

- **Modes**: Photo; Burst (3 rapid shots); 4-Frame (4 shots 3s apart, presented as a
  2x2 grid); GIF/boomerang; Video is a disabled placeholder only.
- **Countdown**: 1/3/5/10s options; shutter/countdown sounds.
- **Screen flash**: white overlay at capture, default off.
- **Filters — non-destructive** (user decision 2026-07-19): the saved image is the
  RAW frame (mirror correction + date stamp still baked). The chosen filter is stored
  as a string on the photo row (`booth_photo.filter`, nullable; `x-filter` upload
  header) and applied as a CSS filter at display time in grid + lightbox. Share/export
  bakes the filter into pixels at that moment (canvas). Lightbox shows a
  "Remove effect" action when a filter is set — clears it via
  `boothPhotos.clearFilter({groupId})`, restoring the original. Exception: GIF frames
  are assembled at capture, so a GIF's filter stays baked (its `filter` column stays
  null). Filter id→CSS mapping is a shared web module used by camera and gallery.
- **Date-stamp framing** on captures.
- **Share**: to phone via `@capacitor/share` native sheet (new dependency).
- **Delete**: soft delete, no retention window. Never surface "soft delete"/"trash"
  wording in the UI — user-facing copy says delete.
- No pincode on the tile.
- Rejected for v1: face-count hints, slideshow/screensaver, strip composite share, zoom.

## Architecture

### Backend (`products/control-center/api`) — mirrors wake-photo stack

- DB table `boothPhoto` (drizzle, `db/schema.ts`), id `prefix_<id>` convention. Fields:
  id, capturedAt, mode (`photo|burst|four_frame|gif`), file path, mimeType, dimensions,
  group id (groups burst / 4-frame shots), `softDeletedAt` nullable.
- `booth-photo-service`: save (file + row), list (newest first, excludes soft-deleted,
  grouped for gallery), softDelete. Structured logging.
- tRPC router `booth-photos`: `list`, `delete`. Wired into root router.
- HTTP endpoints in `server.ts` mirroring wake-photo upload/serve: POST upload,
  GET serve by id. `image/jpeg` + `image/gif`.

### Frontend (`products/control-center/web`)

- Tile registered in `src/lib/tile-registry.ts` (1x1), opens fullscreen via the
  `TileDetailHost` pattern (`src/lib/tile-detail-store.ts`).
- Camera screen productionized from ApertureV3; capture pipeline: canvas bake
  (filter + mirror + date stamp) → upload; burst/4-frame sequencing; GIF assembly.
- Gallery productionized from GalleryDesign10, data via `booth-photos.list`,
  uses shared `PageHeader` (sticky).
- Camera hook: designs' `useCameraPreview.ts`; prod reference `src/lib/wake-capture.ts`.
- `Icon.tsx` glyphs: use `camera` (not `cam`) and `timer` (already added).
- Storybook-first: real components get stories; the `photo-booth-designs/` prototype
  dir is deleted once real components replace it.

## Testing

- API: service + router tests following existing patterns.
- Web: component tests where the house pattern has them; Storybook stories for tile,
  camera states, gallery (incl. empty state), PageHeader.
- Verify `bun run typecheck`, `bun run lint`, relevant tests before each push.
