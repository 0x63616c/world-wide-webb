# Wake Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a 3-frame front-camera burst when the wall panel wakes from idle dim, store frames on the NAS via the API, and browse them from a subtle stat tile that opens a fullscreen Grid/Timelapse viewer.

**Architecture:** Web hooks `captureWakeBurst()` into `Board.tsx`'s existing `wake()` callback (fires only when dimmed, native display). Frames POST as raw JPEG to a new `/media/wake-photo` route; a filesystem-backed service writes `MEDIA_STORAGE_DIR/wake-photos/YYYY/MM/DD/<epoch-ms>-<n>.jpg`. tRPC `wakePhotos.list` feeds a Storybook-first `WakesTileView` + fullscreen `WakePhotoViewer`. Native shell gets camera permission plumbing (manual iPad rebuild noted).

**Tech Stack:** Bun, tRPC v11, zod, React 19, Storybook, Vitest, Capacitor iOS.

**Spec:** `docs/superpowers/specs/2026-07-17-wake-photos-design.md`

## Global Constraints

- IDs `prefix_<id>`; tile id `tile_wakes`.
- Backend structured logging via `@www/logger` `getLogger()`; services-throw convention.
- UI uses primitives from `web/src/components/ui/`; Storybook-first for new views.
- No fake/placeholder data in product code.
- Tile placement only in `web/src/lib/tile-registry.ts`.
- All paths below relative to `products/control-center/` unless rooted.

---

### Task 1: wake-photo service (API)

**Files:**
- Create: `api/src/services/wake-photo-service.ts`
- Test: `api/src/services/wake-photo-service.test.ts` (pattern: `board-layout-service.test.ts`)

**Interfaces (Produces):**
```ts
export interface WakePhotoDay { day: string /* YYYY-MM-DD */; photos: { path: string; capturedAt: number }[] }
export interface WakePhotoListing { days: WakePhotoDay[]; totalCount: number; totalBytes: number }
export function saveWakePhoto(bytes: Uint8Array, capturedAt: number): Promise<string> // returns rel path
export function listWakePhotos(): Promise<WakePhotoListing>
export function readWakePhoto(relPath: string): Promise<{ bytes: Uint8Array } | null>
```

Behavior:
- Root dir `join(env.MEDIA_STORAGE_DIR, "wake-photos")`, overridable for tests via injected root param or env.
- `saveWakePhoto`: reject non-JPEG (magic `ff d8 ff`) and >2 MB with thrown Error; write `YYYY/MM/DD/<capturedAt>-<seq>.jpg` (seq = existing count with same ts, normally 0-2); mkdir -p; return rel path.
- `listWakePhotos`: walk dirs, days newest-first, photos newest-first, sum sizes.
- `readWakePhoto`: resolve within root; return null on traversal escape or missing file.

- [ ] Write failing tests: save→file exists at dated path; non-JPEG rejected; oversize rejected; list orders newest-first with counts/bytes; read returns bytes; read rejects `../` traversal (null). Use temp dir per test.
- [ ] Run `bun test api/src/services/wake-photo-service.test.ts` — expect fail (module missing).
- [ ] Implement service.
- [ ] Tests pass.
- [ ] Commit `feat(control-center/api): wake-photo storage service`.

### Task 2: routes + tRPC router (API)

**Files:**
- Modify: `api/src/server.ts` (add two `/media/*` branches in `handle()`)
- Create: `api/src/trpc/routers/wake-photos.ts`
- Modify: `api/src/trpc/routers/index.ts` (register `wakePhotos`)

**Interfaces:**
- Consumes Task 1 exports.
- Produces: `POST /media/wake-photo` (raw image/jpeg body, `x-captured-at` epoch-ms header; 201 `{ path }`, 400 on bad input); `GET /media/wake-photos/<rel>` (200 jpeg, `Cache-Control: public, max-age=31536000, immutable`, 404 otherwise); tRPC `wakePhotos.list` → `WakePhotoListing` (zod output schema mirrors interface).

- [ ] Add routes: POST branch parses `Number(req.headers.get("x-captured-at"))` (fallback `Date.now()`), `new Uint8Array(await req.arrayBuffer())`, try/catch → 400 with error message. GET branch: `url.pathname.startsWith("/media/wake-photos/")` → `readWakePhoto(decodeURIComponent(rel))`.
- [ ] Create router with zod schema (`camera.ts` pattern), register in `index.ts`.
- [ ] `bun run typecheck` passes.
- [ ] Commit `feat(control-center/api): wake-photo routes + wakePhotos.list`.

### Task 3: capture on wake (web)

**Files:**
- Create: `web/src/lib/wake-capture.ts`
- Test: `web/src/lib/__tests__/wake-capture.test.ts`
- Modify: `web/src/components/Board.tsx` (`wake` callback, ~line 652)

**Interfaces:**
- Produces: `captureWakeBurst(): void` — fire-and-forget, never throws, self-deduping (no-op if a burst is in flight).

Behavior: getUserMedia `{ video: { facingMode: "user" } }`, hidden video element, frames at 700/1300/2000 ms via canvas `toBlob("image/jpeg", 0.8)`, each `fetch("/media/wake-photo", { method: "POST", headers: { "Content-Type": "image/jpeg", "x-captured-at": String(Date.now()) }, body: blob })`; teardown tracks in `finally`; all errors `console.warn` only. Pure helper `burstDelaysMs = [700, 1300, 2000]` exported for tests; guard flag tested via injected capture fn if practical, else test the pure parts only.

- [ ] Tests for pure parts (delays constant, dedupe guard using injectable runner).
- [ ] Implement; wire in Board: inside `wake` callback, if `dimmed && nativeDisplay` call `captureWakeBurst()` before `wakeDim()`.
- [ ] `bun run typecheck` + web tests pass.
- [ ] Commit `feat(control-center/web): front-camera burst on wake from dim`.

### Task 4: WakesTile + fullscreen viewer (web)

**Files:**
- Create: `web/src/components/tiles/WakesTileView.tsx`, `WakesTileView.stories.tsx`
- Create: `web/src/components/tiles/WakesTile.tsx` (container: `trpc.wakePhotos.list.useQuery`, owns viewer-open state)
- Create: `web/src/components/tiles/WakePhotoViewer.tsx`, `WakePhotoViewer.stories.tsx`
- Modify: `web/src/lib/tile-registry.ts` (entry `tile_wakes`, label "Wakes", small 2x2-ish, `ownsTap: true`, free spot near existing cluster)

**Interfaces:**
- `WakesTileViewProps { status: TileStatus; todayCount?: number; lastWakeLabel?: string | null; onOpen: () => void }`
- `WakePhotoViewerProps { open: boolean; onClose: () => void; days: WakePhotoDay[]; totalCount: number; totalBytes: number; photoUrl: (path: string) => string }` — Grid mode (day-grouped) + Timelapse mode (segmented toggle, play/pause 450 ms cadence, scrub rail), per prototype variant E.

- [ ] Stories first: view states (loading, zero wakes, populated), viewer (grid populated, timelapse). Mock data in stories only.
- [ ] Implement view + viewer with ui primitives (`Tile`, `TileHeader`, `Segmented`, `Modal` or fullscreen overlay div per `ExpandedControlsModalView` pattern).
- [ ] Container + registry entry (`ownsTap: true`; label matches TileHeader title "Wakes").
- [ ] `bun run typecheck`, `bun run lint`, web tests + stories build pass.
- [ ] Commit `feat(control-center/web): Wakes stat tile + fullscreen wake-photo viewer`.

### Task 5: native camera permission (iOS shell)

**Files:**
- Modify: `web/ios/App/App/Info.plist` (`NSCameraUsageDescription`)
- Modify: `web/ios/App/App/KioskViewController.swift` (WKUIDelegate `requestMediaCapturePermissionFor` → `.grant` for `.camera`)

- [ ] Add plist key + delegate override.
- [ ] Commit `feat(control-center/ios): camera permission for wake photos`. Note in commit body: requires manual Xcode rebuild + reinstall on panel.

### Task 6: verify + ship

- [ ] `bun run typecheck && bun run lint && bun run test` green at repo root.
- [ ] Update `CODEBASE_OVERVIEW.md` / docs if behavior lists tiles or media routes.
- [ ] Merge worktree branch to main from MAIN checkout (`git merge --ff-only`), push with `--no-verify` (knip pre-push is pre-existing red).
- [ ] Watch CI/deploy (push to main auto-deploys control-center images); confirm api + web roll.
- [ ] Report deploy status + manual iPad rebuild caveat.
