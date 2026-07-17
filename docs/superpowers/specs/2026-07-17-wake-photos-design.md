# Wake Photos — design

Capture a front-camera photo burst every time the wall panel is woken from its
idle dim by a tap, store the photos on the homelab NAS, and browse them from a
deliberately subtle board tile.

## Decisions (settled with Calum, 2026-07-17)

- **Trigger**: the existing idle-dim wake. "Sleep" on this panel is
  `useIdleDim` dropping the iPad backlight; the wake tap is swallowed by the
  dim overlay and calls `wake()` in `Board.tsx`. Capture hooks into that
  callback and fires only when the panel was actually dimmed. No new native
  wake detection.
- **Capture**: burst of 3 frames over ~2s (at roughly 0.7s / 1.3s / 2.0s after
  the wake tap). Camera opens on tap (no always-on stream while dimmed), each
  frame is grabbed from a hidden `<video>` via canvas as JPEG (~quality 0.8),
  and the stream is torn down after the burst.
- **Storage**: upload to the control-center API, which writes files under
  `MEDIA_STORAGE_DIR/wake-photos/YYYY/MM/DD/<epoch-ms>-<n>.jpg` on the NAS
  mount. The filesystem is the source of truth — no DB table.
- **Retention**: keep forever for now. Rough budget: 3 frames × ~150 KB ×
  ~30 wakes/day ≈ 13 MB/day. The media-worker's existing disk-guard protects
  the mount; revisit retention later if it ever matters.
- **Viewing**: subtle. No photos visible on the board. A small stat tile
  ("Wakes — 12 today · last 14:32") opens a fullscreen viewer with two modes:
  a day-grouped photo grid and a timelapse player (auto-advancing frames with
  play/pause + scrub). Prototype: variant E in
  `wake-photos-tile-prototype.html` (throwaway, scratchpad).

## Architecture

### API (`products/control-center/api`)

- `services/wake-photo-service.ts` — services-throw convention, structured
  logging:
  - `saveWakePhoto(bytes, capturedAt)` — validates JPEG magic + size cap
    (2 MB), writes to the dated directory, returns the stored relative path.
  - `listWakePhotos()` — walks `wake-photos/`, returns days (newest first)
    with photo entries `{ path, capturedAt }` and total count/bytes.
  - `readWakePhoto(relPath)` — path-traversal-safe read of one photo.
- `server.ts` routes:
  - `POST /media/wake-photo` — raw JPEG body, `x-captured-at` header
    (epoch ms). 201 on success.
  - `GET /media/wake-photos/<YYYY/MM/DD/name.jpg>` — serves bytes,
    long-lived cache (immutable content).
- tRPC `wakePhotos.list` — the viewer's listing query (days, counts, sizes).

### Web (`products/control-center/web`)

- `lib/wake-capture.ts` — `captureWakeBurst()`: getUserMedia (front camera,
  `facingMode: "user"`), 3 timed frames → JPEG blobs → POST each. Never
  throws to the caller; failures log and give up (panel UX must be
  unaffected). Guarded so overlapping wakes can't double-capture.
- `Board.tsx` — `wake()` fires `captureWakeBurst()` (fire-and-forget) only
  when the panel was dimmed and the display is native.
- `WakesTile` (container) + `WakesTileView` (presentational, Storybook-first)
  — stat tile: wake count today + last wake time from `wakePhotos.list`.
- `WakePhotoViewer` — fullscreen modal (existing modal pattern): Grid mode
  (day-grouped) and Timelapse mode (segmented toggle, play/pause, scrub).
- `tile-registry.ts` — register `WakesTile`, small footprint, `ownsTap` so
  the tap opens the viewer.

### Native shell (`web/ios`)

- `Info.plist`: `NSCameraUsageDescription`.
- `KioskViewController`: auto-grant WKWebView media-capture permission
  (`requestMediaCapturePermissionFor` → `.grant`) so the kiosk never shows a
  permission prompt.
- **Deploy caveat**: web+API changes reach the panel on the next deploy, but
  the Info.plist/KioskViewController changes need a manual Xcode rebuild +
  reinstall on the iPad before the camera works. Until then capture fails
  silently by design.

## Error handling

- Capture path is best-effort: any getUserMedia/canvas/upload error logs to
  console and aborts the burst. The wake interaction itself is never blocked.
- API validates content (JPEG magic, size cap) and rejects path traversal.
- Viewer shows the standard tile loading/error states via tRPC query status.

## Testing

- API: unit tests for the service (save path shape, traversal rejection,
  listing order) following existing api test patterns.
- Web: Storybook stories for `WakesTileView` and `WakePhotoViewer` states
  (empty, populated, timelapse); component tests per repo pattern.
- Capture logic: pure helpers (burst timing, blob naming) unit-tested;
  getUserMedia itself exercised manually on the panel.

## Non-goals

- Retention/pruning (keep forever for now).
- Face detection, dedup, motion analysis.
- Off-panel/web viewing surface beyond the API endpoints existing.
