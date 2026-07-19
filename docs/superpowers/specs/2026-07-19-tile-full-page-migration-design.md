# Tile Full-Page Migration — Design

**Date:** 2026-07-19
**Product:** `products/control-center/web`
**Status:** Approved

## Goal

Tapping any tile on the board opens a full-page detail screen instead of a modal.
This pass is a mechanical migration: keep each tile's existing detail content and
its variant system, change only the container. Per-screen redesigns come later.

Dialogs remain only for interruptions and gates: `ConfirmDialog` and
`PinGateModal`. Everything else becomes a page. No exceptions — the transient
remotes (`ExpandedControlsModalView`, `TvRemoteModal`) also become pages.

## Current state (from audit)

Two tap paths exist, forked on `entry.ownsTap` (`lib/tile-registry.ts`):

- **Board-registry modals (7 tiles):** Clock, Weather, Network, Tesla, Next 12
  Hours, Climate, Upcoming. `ownsTap: false`; `Board.tsx` looks the tile up in
  `components/tiles/modals/registry.ts` and renders via `TileModalHost`, which
  also renders the floating `VariantSwitcher`. ~29 variant components each
  hard-code their own `<Modal open onClose title width maxHeight>` chrome.
- **Self-owned modals (8 tiles, 11 modals):** Controls, Schedules, TV (×2),
  Sound, TV Apps, Quick Play (×2), Deploys, Notifications. `ownsTap: true`;
  each tile holds local modal state, usually opened from an inner "More"/"Open"
  button rather than the tile face.
- **Full-page already (2):** Activity (`WakesTile` → `PinGateModal` →
  `ActivityPage`), Frontend Logs (deep-links into Settings via
  `open-settings-store`).
- **Dead ends (2):** DogCam, DogMode — `ownsTap: false` but absent from the
  modal registry, so a tap glides the camera and silently does nothing.

The full-page mechanism to replicate is `SettingsPage.tsx` (and its clone
`ActivityPage.tsx`): a body portal, `position: fixed; inset: 0; z-index: 100`,
`env(safe-area-inset-*)` padding, `registerOpenModal()` from
`lib/modal-open-store.ts` to freeze board pan/snap and hook the idle reset,
Escape to close, `BackButton` from `settings-page/blocks.tsx`.

## Architecture

### `lib/tile-detail-store.ts` — the single seam

```ts
openTileDetail(tileId: TileId, variantId?: string): void
closeTileDetail(): void
useTileDetail(): { tileId: TileId; variantId?: string } | null
```

`useSyncExternalStore`-backed live value (not one-shot like
`open-settings-store`). **Nothing anywhere opens a detail via local state** —
every entry point calls `openTileDetail`. This is the future-routing seam: when
real routing lands (deferred decision "B"), this file's internals are replaced
by router params and no call site changes.

### `components/tiles/detail/registry.ts`

Replaces `components/tiles/modals/registry.ts`. **Every tile has an entry** —
enforced by typing the registry as `Record<TileId, TileDetailEntry>` so a
missing tile is a type error, not today's silent no-op.

```ts
type TileDetailEntry =
  | {
      kind: "page"
      title: string
      requiresPin?: true
      variants: readonly [TileDetailVariant, ...TileDetailVariant[]]
    }
  | { kind: "action"; run: () => void } // e.g. Frontend Logs → openSettingsOnPage("logs")
type TileDetailVariant = {
  id: string
  label: string
  Component: ComponentType
}
```

### `components/tiles/detail/TileDetailHost.tsx`

Replaces `TileModalHost`. Rendered once from `Board.tsx`, driven purely by
`useTileDetail()`. Mechanics copied from `SettingsPage.tsx`:

- body portal, `position: fixed; inset: 0; z-index: 100`, safe-area padding
- `registerOpenModal(() => closeTileDetail())` — board freeze + idle-reset
- Escape closes; `BackButton` top-left; page title in header
- interaction logging of open/close, matching Settings
- hosts the existing floating `VariantSwitcher`, hidden when the entry has one
  variant
- content column defaults to **full width** (unlike Settings' 720px cap); an
  entry may opt into a max-width later. Wrong-looking screens are per-page
  redesign work, not shell work.
- The `modal-no-enter` / `ENTER_MS` animation-suppression hack in
  `TileModalHost` is deleted, not ported — it existed to stop variant switches
  replaying the modal entrance animation.

### PIN gating

The registry entry carries `requiresPin?: true`. `TileDetailHost` runs
`PinGateModal` (unchanged) before mounting the page, using the two-flag
`gateOpen`/`pageOpen` pattern from `SettingsButton.tsx` so the gate unmounts
before the page mounts (no double-overlay flash). Activity folds in:
`WakesTile` loses its hand-wired gate and becomes a registry entry with
`requiresPin: true` whose single variant renders the `ActivityPage` body.
Settings keeps its own gate — it is not a tile. Frontend Logs keeps
deep-linking into Settings; `open-settings-store` is untouched this pass.

### Page component contract

Variants lose their modal chrome and props:

```tsx
// before
export function TeslaModalChargeSession({ open, onClose }) {
  return <Modal open={open} onClose={onClose} title="…" width={720} maxHeight={640}>…</Modal>
}
// after
export function TeslaDetailChargeSession() { return <>…</> }
```

Known quirks to preserve: `Next12Hours` ThermalDayArc returns `<Modal>` from
two branches; `EventsModalManage` is a write path whose internal confirm flow
must keep working.

### Board changes

- `ownsTap` deleted from `tile-registry.ts`.
- `Board.tsx` tap capture collapses to: glide camera, `openTileDetail(tileId)`.
- `INTERACTIVE_SELECTOR` stays — inner controls (sliders, in-face buttons like
  TV Apps' launchers) still swallow their own taps.
- The keyboard early-return for `ownsTap` tiles is removed, fixing Enter/Space
  on the 10 tiles where it is currently dead.

## Per-tile disposition (19 tiles)

| Tile | Variants on its page |
|---|---|
| Clock, Weather, Network, Tesla, Next12h, Climate, Upcoming | Existing 4–5 variants, unchanged content |
| Controls | 1 variant: `ExpandedControlsModalView` body |
| Schedules | 1 variant: `ExpandedSchedulesModalView` body |
| TV | 2 variants: Transport (`TransportScrubModal` body), Remote (`TvRemoteModal` body) |
| Sound | 1 variant: `GroupsModalView` body |
| TV Apps | 1 variant: `AllAppsModal` body; face taps still launch apps directly |
| Quick Play | 2 variants: Favorites (`FavoritesModal` body), Spotify (`SpotifyModal` body) |
| Deploys | 1 variant: existing modal body |
| Notifications | 1 variant: `ExpandedNotificationCenterModalView` body (tabs stay internal) |
| Activity | 1 variant: `ActivityPage` body, `requiresPin: true` |
| Frontend Logs | `kind: "action"` entry — keeps deep-linking to Settings Logs page via `openSettingsOnPage("logs")` (unchanged this pass) |
| DogCam | 1 honest variant: current live/rec state + "not yet connected" note |
| DogMode | 1 honest variant: current preview state + "not yet connected" note |

For DogCam/DogMode no new features are designed — the page states what the tile
face already states. This removes the silent-no-op class without inventing
screens. (No fake data; the note is truthful.)

Self-owned tiles drop their "More"/"Open" buttons — the whole face opens the
page. TV's and Quick Play's two modals become two variants of one page, reusing
the switcher instead of inventing tabs.

## Sequencing (each step ships green to `main`)

1. **Shell:** store + host + typed registry, group 1 wired through a temporary
   shim that still renders the old `<Modal>`-wrapped variants. Board still on
   the old path. No user-visible change.
2. **Flip group 1** to `TileDetailHost`. `ownsTap` branch still exists for
   group 2.
3. **Strip `<Modal>`** from the ~29 group 1 variants; delete the shim. Big but
   mechanical, isolated diff.
4. **Group 2, one commit per tile** (8 commits): flip `ownsTap` off, delete
   local modal state, register the body.
5. **Cleanup:** delete `ownsTap`, collapse the Board tap fork, restore keyboard
   handling, delete `TileModalHost` + `modals/registry.ts` + dead files
   (`knip` confirms).
6. **Activity fold-in** with `requiresPin`; DogCam/DogMode honest pages.

## Verification

- Storybook-first: host stories for one-variant, multi-variant, and PIN-gated
  cases; existing modal stories convert alongside step 3.
- `bun run typecheck` + `bun run test` before every push; `bun run knip` at
  step 5.
- Real-panel screenshot check after steps 2 and 5.

## Risks

- Step 3's 29 near-identical edits are the likeliest source of silent visual
  regressions — Storybook conversions are the guard.
- Step 4 changes tap affordances: faces that previously required a specific
  button now open on any face tap; watch for accidental opens.
- Any new overlay must register with `modal-open-store` or the board pan-jitter
  bug returns.

## Deferred (explicitly out of scope)

- Real routing / URLs / history (decision: portal overlay now, store designed
  so routing is an internals swap later).
- Per-screen layout redesigns for the full-width canvas.
- Notification-tap deep links.
- Generalizing `open-settings-store`.
