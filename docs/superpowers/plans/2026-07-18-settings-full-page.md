# Full-Page Settings + PIN Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the settings modal with a full-page (1366x1024) Concept-A settings page (sidebar with tinted icon chips + grouped cards), 8 pages backed by real data, plus a synced 6-digit PIN gate for Settings and Wake photos, and a minimap show/hide setting.

**Architecture:** The full page is a body-portal overlay (same pattern as `LevelOverlay`), opened by `SettingsButton` behind a PIN gate modal. Page content is presentational components per settings page; live state comes from the existing module-level settings store (`lib/settings`), which already syncs every field across panels through the server's settings singleton (`settings-service.ts`). The PIN is just another synced settings field — frontend-only enforcement, no API auth.

**Tech Stack:** React + inline styles with tokens.css vars, shared ui primitives (`Switch`/`Slider`/`Segmented`/`TextInput`), tRPC for real data (`network.status`, `health.ping`), Storybook-first, Vitest.

## Global Constraints

- Fixed wall panel 1366x1024, not responsive.
- Storybook-first: every new view gets a story; stories need `tags: ["autodocs"]`.
- No fake or placeholder data in shipped components (pre-commit hook also blocks `DEMO_`/`demo_` identifiers).
- Use shared primitives from `products/control-center/web/src/components/ui/`.
- Backend uses structured logging; PIN is NOT auth — the API never validates it beyond schema shape.
- Default PIN `"000000"`, exactly 6 digits. Change flow: current → new → confirm (new typed twice).
- Dim-after and recenter-after sliders cap at 10 minutes in the UI. Server keeps accepting up to 1 h (back-compat with stored values); web clamps on write.
- Commit + push to `main` after every task (`git push --no-verify` — knip pre-push is a pre-existing fail). Run `bun run typecheck` + touched tests before each push.
- All work in the main checkout, sequential tasks — no worktrees, no parallel pushes.
- Concept files `SettingsPageConcepts.*` and `PinConcepts.*` in `products/control-center/web/src/components/settings-page/` are the approved visual reference (Concept A). Copy their styling; delete them in the final task.

## File Structure

```
products/control-center/web/src/
  lib/settings.ts                     (modify: new fields + setters + 10-min cap)
  components/pin/
    PinPad.tsx                        (new: PinPadView presentational pad)
    PinGateModal.tsx                  (new: overlay modal wrapping the pad)
    PinPad.stories.tsx, PinGateModal.stories.tsx
  components/settings-page/
    blocks.tsx                        (new: PageFrame/SectionCard/RowShell/SliderRow/ChevronValue/ActionButton/BackButton)
    pages.ts                          (new: PageKey + PAGES registry w/ icons+tints)
    SettingsPage.tsx                  (new: portal overlay container, sidebar + routing)
    SettingsPage.stories.tsx
    pages/DevicePage.tsx ... SecurityPage.tsx  (new: one file per page)
  components/SettingsButton.tsx       (modify: PIN gate + open full page)
  components/Board.tsx                (modify: minimap gated by setting)
  components/tiles/WakesTile.tsx      (modify: PIN gate before WakePhotoViewer)
products/control-center/api/src/services/settings-service.ts  (modify: schema + defaults)
```

---

### Task 1: Settings store + server schema fields

**Files:**
- Modify: `products/control-center/web/src/lib/settings.ts`
- Modify: `products/control-center/api/src/services/settings-service.ts`
- Test: `products/control-center/web/src/lib/__tests__/settings.test.ts` (extend existing if present, else create), `products/control-center/api/src/__tests__/settings.test.ts` (extend existing)

**Interfaces:**
- Produces (web `lib/settings.ts`): `Settings` gains `showMinimap: boolean`, `pinCode: string`. New exports: `setShowMinimap(v: boolean)`, `setPinCode(pin: string)` (ignores input not matching `/^\d{6}$/`), `PIN_LENGTH = 6`, `DEFAULT_PIN = "000000"`, `MAX_IDLE_TIMEOUT_MS` changed to `10 * 60_000`. (No lock toggles — the PIN gates are always-on per Calum.)
- Produces (api `settings-service.ts`): `settingsSchema` gains `showMinimap: z.boolean()`, `pinCode: z.string().regex(/^\d{6}$/)`; `DEFAULTS` gains `showMinimap: true, pinCode: "000000"`. Server timeout max stays 3_600_000 (do NOT tighten — stored 1 h values must keep validating).

**Steps:**

- [ ] Write failing web test: defaults include the four new fields; `setPinCode("123456")` updates; `setPinCode("12x")` and `setPinCode("12345")` are no-ops; `resetSettings()` restores `pinCode` to `"000000"`; `MAX_IDLE_TIMEOUT_MS === 600_000`.
- [ ] Run: `cd products/control-center/web && bunx vitest run src/lib/__tests__/settings.test.ts` — expect FAIL.
- [ ] Implement web store: add fields to `Settings` interface + `DEFAULT_SETTINGS`, add the four setters following the existing `setShowFps` pattern (each writes through `update()` so the server sink fires), change `MAX_IDLE_TIMEOUT_MS` to `10 * 60_000`. Existing hydrate path needs no change (partial merge).
- [ ] Extend api `settingsSchema` + `DEFAULTS` as above; extend api settings test to assert defaults merge (existing test file shows the pattern).
- [ ] Run web + api tests, `bun run typecheck` from repo root — expect PASS.
- [ ] Commit `feat(control-center): settings gain minimap toggle + synced PIN fields`, push.

### Task 2: PinPad + PinGateModal real components

**Files:**
- Create: `products/control-center/web/src/components/pin/PinPad.tsx`, `PinGateModal.tsx`, `PinPad.stories.tsx`, `PinGateModal.stories.tsx`
- Reference: `components/settings-page/PinConcepts.tsx` (styling to copy), `components/ui/Modal.tsx` (portal + registerOpenModal pattern)

**Interfaces:**
- Produces: `PinPadView({ entered, error, onDigit, onBackspace })` — copy from PinConcepts verbatim (incl. the rotated-chevron backspace).
- Produces: `PinGateModal({ open, title, onClose, onSuccess }: { open: boolean; title: string; onClose: () => void; onSuccess: () => void })` — portal to body, dim backdrop, centered card exactly like the approved `PinUnlockModalConcept` dialog (lock icon chip, title, "<title> is locked" copy, pad, Cancel). Card size per Calum's approved screenshot: width 720, padding "48px 40px 44px" — the generous Security-card sizing, not a compact dialog. Reads `useSettings().pinCode`; wrong full entry clears + flashes error; right entry shows unlocked state ~250 ms then calls `onSuccess`. Registers `registerOpenModal` while open and closes on Escape (copy Modal.tsx's effect). Logs open/close via `interaction("modal", ...)` with target `modal.pin.<title>`.

**Steps:**

- [ ] Write `PinPad.tsx` (presentational, no store).
- [ ] Write `PinGateModal.tsx` per interface above.
- [ ] Stories: pad alone (play: tap digits fills dots); gate modal open over `boardWrapper: false` fullscreen frame (play: tap 0 six times → onSuccess fires — assert via a visible "unlocked" state or spy arg).
- [ ] Run `bunx vitest run` for any story tests + `bun run typecheck` — PASS.
- [ ] Commit `feat(control-center/web): PinPad + PinGateModal components`, push.

### Task 3: settings-page scaffolding (blocks, registry, shell)

**Files:**
- Create: `components/settings-page/blocks.tsx`, `pages.ts`, `SettingsPage.tsx`, `SettingsPage.stories.tsx`
- Reference: `SettingsPageConcepts.tsx` Concept A (`SettingsConceptGroupedCards`) — copy PageFrame, sidebar button styling (34px tinted icon chip, selected `var(--nest)` + `var(--hair-2)` border), BackButton (38px chevron-only, LEFT of the "Settings" h1), grouped-card section framing, SliderRow.

**Interfaces:**
- Produces (`pages.ts`): `type PageKey = "device" | "display" | "board" | "network" | "notifications" | "security" | "debug" | "about"`; `PAGES: { key, label, icon, tint, blurb }[]` — reuse concept tints; security uses icon `"lock"`, tint `"#c95c5c"`; notifications keeps `"bell"` tint `"#e0a83c"`-adjacent or concept value.
- Produces (`blocks.tsx`): `SectionCard({ title, children })` (mono uppercase label + inset card; children are keyed row elements, each wrapped `padding: "14px 20px"` with hairline top borders between), `RowShell({ label, sub, control })`, `SliderRow({ children })`, `ChevronValue({ value, onClick? })`, `ActionButton({ children, onClick })`, `BackButton({ onClick })`, `PageHeader({ title, blurb })`.
- Produces (`SettingsPage.tsx`): `SettingsPage({ open, onClose, onOpenLevel, onOpenClean }: { open: boolean; onClose: () => void; onOpenLevel: () => void; onOpenClean: () => void })` — body portal, `position: fixed; inset: 0; zIndex: 100`, `registerOpenModal` + Escape + `interaction` logging (copy Modal.tsx), sidebar owns `useState<PageKey>("device")` (reset to "device" on close), right side renders the active page component. Until page tasks land, render pages from a `PAGE_COMPONENTS: Partial<Record<PageKey, ComponentType<PageProps>>>` map with a plain "coming soon"-free fallback: just render nothing for missing keys (all keys filled by Task 5/6). `type PageProps = { onClose: () => void; onOpenLevel: () => void; onOpenClean: () => void }`.

**Steps:**

- [ ] Write `pages.ts`, `blocks.tsx`, `SettingsPage.tsx`.
- [ ] Story: full page open (fullscreen, `boardWrapper: false`), play asserts sidebar buttons for all 8 pages exist.
- [ ] `bun run typecheck` + story test — PASS. Commit `feat(control-center/web): full-page settings shell`, push.

### Task 4: Device, Display, Board pages (real store)

**Files:**
- Create: `components/settings-page/pages/DevicePage.tsx`, `DisplayPage.tsx`, `BoardPage.tsx` (+ a story per page under the same dir)
- Reference: `components/SettingsPanel.tsx` for the exact wiring (device name, battery, tilt, sliders, snap, edit layout, clean screen).

**Interfaces:**
- Consumes: blocks from Task 3; `useSettings` + setters incl. Task 1's `setShowMinimap`; `useDeviceName`/`setDeviceName`/`deriveDefaultName`; `useBatteryInfo(true)`/`formatBattery`; `useTiltAngle(true)`/`formatTilt`; `openLayoutEditor`; `getDeviceId`.
- Produces: `DevicePage(props: PageProps)`, `DisplayPage(props: PageProps)`, `BoardPage(props: PageProps)` registered into `PAGE_COMPONENTS`.

Page content (mirror concepts, real data):
- Device — Identity card: device-name TextInput (SettingsPanel semantics: value empty until set, placeholder = derived default). Status card: Battery row (`formatBattery` or "unavailable"), Level row (`ChevronValue` showing `formatTilt`, onClick `onOpenLevel` after `onClose`), Device ID row (mono `getDeviceId()`).
- Display — Brightness card: brightness slider (clamped store write). Idle dimming card: dim switch + (when on) dim-after slider (max 10 min) + dim-level slider. Maintenance card: Clean screen ActionButton → `onClose` then `onOpenClean`... actually match SettingsButton flow: the container closes itself; pages just call `props.onOpenClean()`.
- Board — Idle card: recenter switch + (when on) recenter-after slider (max 10 min). Feel card: Minimap switch (`showMinimap`/`setShowMinimap`), Board snap StackField + Segmented over real `SNAP_MODES`/`SNAP_MODE_LABEL`. Layout card: Edit layout ActionButton → `openLayoutEditor(); props.onClose()`.

**Steps:**

- [ ] Write the three pages + register in `PAGE_COMPONENTS`.
- [ ] Stories per page (frame in a 720px column on `var(--bg)`); play asserts the key controls by role (mirror SettingsPanel.stories.tsx assertions).
- [ ] Typecheck + story tests PASS. Commit `feat(control-center/web): settings device/display/board pages`, push.

### Task 5: Network, Notifications, Debug, About pages (real data)

**Files:**
- Create: `pages/NetworkPage.tsx`, `NotificationsPage.tsx`, `DebugPage.tsx`, `AboutPage.tsx` + stories

**Interfaces:**
- Consumes: `trpc.network.status.useQuery` (shape: `{ status: "online"|"offline", ssid, down, up, ping }` — see `api/src/trpc/routers/network.ts`), `trpc.health.buildHash.useQuery` (`{ hash, deployedAt }`), `useConnectionStatus`, `useNotifications` (`{ notifications, clear? }` — check hook exports), `LogsModal`, `resetSettings`, `BUILD_HASH`/`BUILD_TIME` from `config/build.ts`, `relativeAgeString` from `lib/relative-age.ts` (check exact export name), `getInstalledBuildNumber` from `lib/app-update.ts`, `getDeviceId`.
- Produces: the four page components registered in `PAGE_COMPONENTS`.

Content:
- Network — Wi-Fi card: SSID, WAN status (StatusDot + text), gateway ping ms, 24 h down/up GB — all from `network.status` (loading: Skeleton rows; error: plain "unavailable" text). Panel card: connection state from `useConnectionStatus` ("connected" / "connection lost since <time>"), `navigator.onLine` row.
- Notifications — Active card: list current `useNotifications()` items (message + detail) with a Dismiss ActionButton per row calling the store's clear; empty state row "No active notifications". (No quiet-hours toggle — that setting doesn't exist; YAGNI.)
- Debug — Overlays card: FPS switch, Build badge switch (real store). Diagnostics card: View logs ActionButton → `LogsModal` (page owns `logsOpen` state exactly like SettingsPanel), Reset settings ActionButton → `resetSettings()`.
- About — Build card: web sha `BUILD_HASH` + age from `BUILD_TIME` (omit age when not finite), server sha/deployedAt from `health.buildHash`, app build number (async `getInstalledBuildNumber`, "n/a" when null). Device card: device id, screen `1366×1024`.

**Steps:**

- [ ] Write pages + stories (stories for trpc-backed pages must wrap in the storybook trpc/query decorator if one exists — check how `NetworkTile` stories mock; reuse that pattern).
- [ ] Typecheck + story tests PASS. Commit `feat(control-center/web): settings network/notifications/debug/about pages`, push.

### Task 6: Security page (change-PIN flow + lock toggles)

**Files:**
- Create: `pages/SecurityPage.tsx` + story
- Reference: approved `PinConcepts.tsx` `PinChangeFlowConcept` (styling + stage machine verbatim).

**Interfaces:**
- Consumes: `PinPadView` (Task 2), `useSettings().pinCode`, `setPinCode`, `setPinLockSettings`, `setPinLockWakePhotos`.
- Produces: `SecurityPage(props: PageProps)` registered in `PAGE_COMPONENTS`.

Content: Change PIN card with the three-stage flow (verify current against `settings.pinCode` → enter new → confirm new; mismatch restarts at "new" with error; success calls `setPinCode(newPin)` and shows the done state with a "Change again" ActionButton resetting to stage "current"). NO "Locked tiles" card — the gates are always-on, not configurable (Calum's call).

**Steps:**

- [ ] Write page + register. Story play: walk the full flow with default PIN 000000 → new 123456 → confirm → assert done copy (story must not rely on server sync; store is local in Storybook).
- [ ] Typecheck + tests PASS. Commit `feat(control-center/web): settings security page with change-PIN flow`, push.

### Task 7: Wire it in — SettingsButton PIN gate + full page, minimap gate, wake-photos gate

**Files:**
- Modify: `components/SettingsButton.tsx` (drop Modal+SettingsPanel; gear tap → always open `PinGateModal` titled "Settings", success → `SettingsPage`; keep hosting LevelOverlay/CleanScreenOverlay wired to page props)
- Modify: `components/Board.tsx` minimap render site (`settings.showMinimap ? <Minimap .../> : null` — find via `grep -n "<Minimap" src/components/Board.tsx`; also gate the centered-tile label block that positions relative to the minimap if it reads as part of it — check `Board.minimap-visibility.test.tsx` for the existing visibility contract and extend it)
- Modify: `components/tiles/WakesTile.tsx` (opening `WakePhotoViewer` always goes through `PinGateModal` titled "Wake photos")
- Delete: `components/SettingsPanel.tsx`, `SettingsPanel.stories.tsx` (LogsModal stays — Debug page uses it)
- Test: extend `Board.minimap-visibility.test.tsx`; update any tests importing SettingsPanel.

**Steps:**

- [ ] SettingsButton rewrite per above (page owns no overlays; button hosts them as today).
- [ ] Minimap gate + test (showMinimap=false → no minimap in DOM).
- [ ] WakesTile gate.
- [ ] Delete SettingsPanel + fix imports. `bun run typecheck && bun run test` (web) — PASS.
- [ ] Commit `feat(control-center/web): full-page settings live behind PIN gate; minimap + wake photos gated`, push.

### Task 8: Cleanup + docs + verify

**Files:**
- Delete: `settings-page/SettingsPageConcepts.tsx`, `SettingsPageConcepts.stories.tsx`, `PinConcepts.tsx`, `PinConcepts.stories.tsx`
- Modify: `CODEBASE_OVERVIEW.md` (settings modal → full page; PIN gate; minimap setting) if it mentions the settings modal.

**Steps:**

- [ ] Delete concepts, update docs, `bun run typecheck && bun run test && bun run lint` from root — PASS (lint scoped to changed files if repo lint has pre-existing failures).
- [ ] Storybook screenshot of `SettingsPage` story via cmux browser for visual confirmation.
- [ ] Commit `chore(control-center/web): drop settings/PIN concepts, docs for full-page settings`, push.
