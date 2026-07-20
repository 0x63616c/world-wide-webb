# Photo Booth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Photo booth feature — board tile → fullscreen camera → server-stored photos → gallery — to the wall panel in prod.

**Architecture:** Backend mirrors the wake-photo stack (separate `boothPhoto` table, storage dir, tRPC router `boothPhotos`, upload/serve HTTP endpoints) — being built by the `backend-builder` agent per the spec; this plan covers frontend + integration. Frontend productionizes three approved Storybook prototypes (tile `MinimalMarkV2B`, camera `ApertureV3`, gallery `GalleryDesign10`) and extracts a shared sticky `PageHeader` used by every fullscreen page.

**Tech Stack:** React 19 inline-style components, tRPC + TanStack Query, Capacitor (`@capacitor/share` new dep), canvas capture bake, `gifenc` for client GIF assembly, Storybook-first, bun test.

**Spec:** `docs/superpowers/specs/2026-07-19-photo-booth-design.md` — read it first; its "Locked design picks" and "Feature behavior" sections are requirements.

## Global Constraints

- Fixed wall panel 1366x1024, not responsive.
- Never surface "soft delete"/"trash" wording in UI copy — say "Delete".
- No fake/placeholder data in production components.
- IDs `prefix_<id>` style.
- Icon glyphs: `camera` and `timer` exist in `src/components/Icon.tsx`; use `camera`, never `cam`.
- Every `*.stories.tsx` meta needs `tags: ["autodocs"]` (pre-commit hook enforces).
- Pre-push runs knip: no unused files/exports; the prototype dir `photo-booth-designs/` must be deleted in the final task, not before (stories keep it referenced until then).
- Shared UI primitives from `src/components/ui/`; tile placement in `src/lib/tile-registry.ts`.
- Verify `bun run typecheck` + relevant tests before every push; commit+push per task (continuous delivery to prod).
- All web paths below relative to `products/control-center/web/`.

---

### Task 1: Shared sticky `PageHeader` in components/ui + TileDetailHost adoption

**Files:**
- Create: `src/components/ui/PageHeader.tsx`
- Modify: `src/components/ui/index.ts` (export)
- Modify: `src/components/tiles/detail/TileDetailHost.tsx:140-143` (replace inline header row)
- Create: `src/components/ui/PageHeader.stories.tsx`

**Interfaces:**
- Produces: `PageHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode })` — a `flexShrink: 0` header row (BackButton + h1 + optional right slot pushed with `marginLeft: "auto"`). Pages using it must be flex-column with the scroll region `flex:1; minHeight:0; overflowY:auto` so the header stays pinned.
- Consumes: `BackButton` from `src/components/settings-page/blocks` (move/re-export decision: keep BackButton where it is, import it — do not relocate).

Match the existing TileDetailHost header exactly (gap 14, padding 24, h1 fontSize 28 / weight 700) so adoption is a no-op visually. Story shows title-only and title+right-slot variants. TileDetailHost passes `right` as nothing; gallery later passes photo count.

- [ ] Write `PageHeader` + story; adopt in TileDetailHost.
- [ ] `bun run typecheck`; verify TileDetailHost story unchanged in Storybook.
- [ ] Commit `feat(control-center/web): shared sticky PageHeader, adopt in TileDetailHost`, push.

### Task 2: Booth photo data layer + capture pipeline lib

**Files:**
- Create: `src/lib/booth-capture.ts` (canvas bake + upload)
- Create: `src/lib/__tests__/booth-capture.test.ts`

**Interfaces:**
- Consumes: backend endpoints per spec — tRPC `boothPhotos.list` / `boothPhotos.delete`, `POST /booth-photos` upload, `GET /booth-photos/:id` serve (confirm exact names against the backend-builder's landed code in `products/control-center/api` before writing; the spec is the contract, the code is the truth).
- Produces:
  - `bakeFrame(video: HTMLVideoElement, opts: { filterCss: string; mirror: boolean; stampDate: Date }): Promise<Blob>` — draws current video frame to canvas at native resolution, applies `ctx.filter = filterCss`, horizontal mirror via `scale(-1,1)`, bottom-right date stamp (mono, translucent), returns JPEG blob (quality 0.9).
  - `assembleGif(frames: Blob[], opts: { delayMs: number; boomerang: boolean }): Promise<Blob>` using `gifenc` (add dep with `bun add gifenc` in web product).
  - `uploadBoothPhoto(blob: Blob, meta: { mode: BoothMode; groupId?: string; capturedAt: number }): Promise<{ id: string }>` — mirrors `wake-capture.ts` upload mechanics.
  - `type BoothMode = "photo" | "burst" | "four_frame" | "gif"`.

Test the bake with an offscreen canvas fixture (happy path + mirror + filter string applied); upload tested with a mocked fetch, following patterns in `src/lib/__tests__/`. Reference `src/lib/wake-capture.ts` for the existing upload shape and device headers.

- [ ] Failing tests → implement → green.
- [ ] `bun run typecheck`; commit `feat(control-center/web): booth capture pipeline (bake, gif, upload)`, push.

### Task 3: Production camera screen from ApertureV3

**Files:**
- Create: `src/components/tiles/photo-booth/BoothCamera.tsx` (+ split subcomponents if >~400 lines: `BoothCameraControls.tsx`, `BoothCountdown.tsx`)
- Create: `src/components/tiles/photo-booth/booth-sounds.ts` (WebAudio shutter + countdown ticks, tiny synthesized beeps — no audio asset files)
- Create: `src/components/tiles/photo-booth/BoothCamera.stories.tsx`
- Copy-adapt: `src/components/photo-booth-designs/camera/ApertureV3.tsx`, `camera-shared.ts` (filters), `useCameraPreview.ts` → productionized versions inside `photo-booth/` (prototype dir untouched until Task 6)

**Interfaces:**
- Consumes: Task 2's `bakeFrame`/`assembleGif`/`uploadBoothPhoto`; house `Modal`, `Segmented` from `components/ui`; `Icon` glyphs `camera`, `timer`.
- Produces: `BoothCamera({ onOpenGallery }: { onOpenGallery: () => void })` — self-contained fullscreen camera; uploads on capture.

Behavior (all locked in spec): timer cycle button Off→1→3→5→10s; screen-flash toggle (white overlay at capture, default off); 7 CSS filters live-preview + baked; modes Photo/Burst(3 rapid)/4-Frame(4 shots 3s apart, one groupId)/GIF(boomerang ~12 frames)/Video disabled "soon"; countdown sounds + shutter sound via booth-sounds; gallery button bottom-left. Burst/4-frame share a generated `groupId` (`crypto.randomUUID()`). Stories: idle, countdown, filter modal open — camera stream mocked as in the prototype stories.

- [ ] Productionize; stories; `bun run typecheck`.
- [ ] Commit `feat(control-center/web): photo booth camera screen`, push.

### Task 4: Production gallery from GalleryDesign10 + share + delete

**Files:**
- Create: `src/components/tiles/photo-booth/BoothGallery.tsx`
- Create: `src/components/tiles/photo-booth/BoothGallery.stories.tsx`
- Modify: `package.json` (`bun add @capacitor/share`; run `bunx cap sync ios` in `ios/` per existing Capacitor workflow if config requires)

**Interfaces:**
- Consumes: tRPC `boothPhotos.list` / `boothPhotos.delete` via the app's trpc client hooks (see existing `wake-photos` usage for the pattern); serve URL builder from Task 2; `PageHeader` from Task 1; `@capacitor/share` `Share.share({ url | files })` on native, hidden/no-op fallback on web.
- Produces: `BoothGallery({ onBack }: { onBack: () => void })`.

Minimal Squares design: edge-to-edge 8-col square grid, bold date headers, mode tinted dot, quiet lightbox with Share + Delete. `PageHeader` title "Photos", `right` = photo count, sticky above single scroll region. Delete = `boothPhotos.remove({groupId})` + optimistic removal; copy is "Delete" (never trash/soft-delete wording). Empty state from GalleryDesign01's empty treatment, restyled minimal. 4-frame groups render as one composite 2x2 cell in the grid (group by groupId).

Lightbox layout (user-specified, overrides prototype): Delete top-left; photo date on the left; `‹`/`›` buttons flanking the image, stepping through the whole roll in time order (wrap or disable at ends — disable); Share bottom-right; close via backdrop tap (anywhere outside image) or Escape — no close button.

Backend contract (landed, 36eeb0f07): tRPC `boothPhotos.list` (groups newest-first, frames by frame_idx) and `boothPhotos.remove({groupId}) → {removed}`; serve `GET /media/booth-photos/<path>`; upload `POST /media/booth-photo` raw body + x-mode/x-captured-at/x-frame-idx/x-group-id/x-device-id headers.

- [ ] Productionize; stories (populated + empty); `bun run typecheck`.
- [ ] Commit `feat(control-center/web): photo booth gallery`, push.

### Task 5: Tile + registry + fullscreen wiring

**Files:**
- Create: `src/components/tiles/photo-booth/PhotoBoothTile.tsx` (from `photo-booth-designs/tile/MinimalMarkV2B.tsx`)
- Create: `src/components/tiles/detail/wiring/photo-booth.tsx` (follow `wiring/activity.tsx` pattern; hosts BoothCamera ⇄ BoothGallery internal navigation)
- Modify: `src/lib/tile-registry.ts` (1x1 placement — pick a free cell; cell ≈94.33px, 18px gap)
- Modify: `src/components/tiles/detail/registry.ts` (register detail entry)
- Create: `src/components/tiles/photo-booth/PhotoBoothTile.stories.tsx`

**Interfaces:**
- Consumes: `TileDetailHost` open mechanics via `src/lib/tile-detail-store.ts`; `BoothCamera`, `BoothGallery`.
- Produces: registered tile, tap → fullscreen camera; camera's gallery button → gallery; gallery back → camera; TileDetailHost back → board. No pincode.

Note: camera wants edge-to-edge; if TileDetailHost's default header+padding shell fights the camera design, the wiring entry should use whatever headerless/full-bleed variant the detail registry supports — inspect `registry.ts`/`types.ts`; if none exists, add a `chrome: "none"` option to the detail entry type and let PageHeader-less pages own their chrome (gallery still uses PageHeader internally).

- [ ] Wire; `bun run typecheck`; tap-through in Storybook story for the wiring.
- [ ] Commit `feat(control-center/web): photo booth tile + fullscreen wiring`, push.

### Task 6: Prototype teardown + full verify + ship

**Files:**
- Delete: `src/components/photo-booth-designs/` (entire dir + its stories)
- Modify: any lingering imports (should be none — Tasks 3-5 copied, not imported)

- [ ] Delete dir; `bun run typecheck && bun run lint && bun run knip && bun run test` (Board tests need 20s timeout under coverage; lint from main checkout).
- [ ] Commit `chore(control-center/web): remove photo booth design prototypes`, push.
- [ ] Verify CI deploy lands: watch the GitHub Actions run for the push; confirm web image built + Pulumi digest pinned; panel gets the update. Gotcha: rapid pushes cancel builds and a later green run can deploy OLD digests — verify pod image age, recover with `force_all` dispatch if needed.
- [ ] Smoke test on panel or via frontend_log table if remote.

---

## Self-review notes

- Backend tasks intentionally absent — owned by `backend-builder` agent (spec §Architecture/Backend). Task 2 must reconcile against its landed code.
- GIF encoder choice (`gifenc`) is the plan's call: tiny, no wasm, works in webview.
- `@capacitor/share` on iOS may need `bunx cap sync` + a TestFlight build (iOS Build workflow auto-ships on push); capability changes are NOT involved, so no profile regen needed.
- Sounds synthesized via WebAudio to avoid binary assets + licensing.
