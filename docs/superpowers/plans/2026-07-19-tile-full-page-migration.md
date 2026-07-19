# Tile Full-Page Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping any board tile opens a full-page detail screen (Settings-style body-portal overlay) instead of a modal; only `ConfirmDialog` and `PinGateModal` remain dialogs.

**Architecture:** A `tile-detail-store` (useSyncExternalStore) is the single open/close seam. A `TileDetailHost` (mechanics copied from `SettingsPage.tsx`) renders the active tile's page from a typed detail registry; the existing floating `VariantSwitcher` is reused. Tiles migrate one at a time: the board checks the NEW detail registry first and falls back to the old modal path, so every commit ships green to `main` (push = prod deploy).

**Tech Stack:** React 19, TypeScript, tRPC/react-query, Storybook, Bun. Product: `products/control-center/web` (fixed 1366×1024 wall panel + Capacitor iOS shell).

**Spec:** `docs/superpowers/specs/2026-07-19-tile-full-page-migration-design.md` — read it first.

## Global Constraints

- Repo root: `/Users/calum/code/github.com/0x63616c/world-wide-webb`. All paths below are relative to `products/control-center/web/` unless prefixed `repo:`.
- Verify per task: `bun run typecheck` and `bun run test` from repo root (tests for web run via the root script). Lint: `bun run lint`.
- Commit + push to `main` after EVERY task, immediately. Push needs `--no-verify` (pre-existing knip failure in the pre-push hook). Push to `main` deploys prod — that is intended and pre-authorized.
- No fake/placeholder data anywhere. Loading states show skeletons, never fabricated values.
- Storybook-first for new UI: new shell components get stories.
- Every overlay opened from a tile MUST register with `registerOpenModal` from `src/lib/modal-open-store.ts` (board pan freeze + idle-reset dismissal) or the pan-jitter bug returns.
- Do not touch `open-settings-store.ts`, `SettingsPage.tsx` behavior, or `PinGateModal.tsx` internals.
- Match surrounding comment density/idiom; biome formatting (`bunx biome format --write` on touched files if needed).

## The Conversion Recipe (referenced by Tasks 4–10)

Every old variant component (`src/components/tiles/modals/*Modal*.tsx`) renders its own `<Modal open onClose title width maxHeight>`. Conversion per component:

1. Delete `open` and `onClose` from its props interface and destructuring.
2. Replace the `<Modal …>` wrapper with `<div style={{ maxWidth: 920, margin: "0 auto" }}>` (keeps the designed layout from stretching absurdly on the 1366px canvas; per-screen redesign comes later). If the component returns `<Modal>` from multiple branches (Next12Hours ThermalDayArc), convert every branch.
3. Drop the `title`/`width`/`maxHeight` values — the host header + switcher labels carry the title now.
4. Keep ALL inner content, handlers, and any internal confirm flows unchanged.
5. Update the tile's wiring module (`modals/wiring/<tile>.tsx`): change each variant's `render: (open, onClose) => <X open={open} onClose={onClose} …/>` to `render: () => <X …/>`, and retype against `DetailVariant`/`TileDetailPageEntry` from `src/components/tiles/detail/types.ts`. Export `<tile>DetailEntry` (kind `"page"`), delete the old `<tile>ModalEntry` export, move the wiring file's registration from `modals/registry.ts` to `detail/registry.ts`.
6. Update that tile's Storybook stories: stories that mounted the Modal-wrapped variant now mount the bare component inside a plain page-sized container. Follow the story file's existing structure.
7. `bun run typecheck && bun run test`, commit (`feat(control-center/web): <tile> detail goes full-page`), push.

## File Structure

New files (all under `products/control-center/web/src/`):

- `lib/tile-detail-store.ts` — open/close seam. Future-routing swap point.
- `lib/__tests__/tile-detail-store.test.ts`
- `components/tiles/detail/types.ts` — `DetailVariant`, `TileDetailEntry` (page | action).
- `components/tiles/detail/registry.ts` — grows one entry per migrated tile; final state covers all 19 tiles.
- `components/tiles/detail/TileDetailHost.tsx` — the page shell + PIN gate + switcher.
- `components/tiles/detail/TileDetailHost.stories.tsx`

Deleted at the end: `components/tiles/modals/TileModalHost.tsx`, `components/tiles/modals/registry.ts`, old `LiveVariant`/`TileModalEntry` types, `ownsTap` field.

---

### Task 1: tile-detail-store

**Files:**
- Create: `src/lib/tile-detail-store.ts`
- Test: `src/lib/__tests__/tile-detail-store.test.ts` (check how sibling store tests, e.g. for `modal-open-store` / `open-settings-store`, are written and follow that harness)

**Interfaces (Produces):**

```ts
export type TileDetailTarget = { tileId: string; variantSlug?: string };
export function openTileDetail(tileId: string, variantSlug?: string): void;
export function closeTileDetail(): void;
export function useTileDetail(): TileDetailTarget | null;   // live value via useSyncExternalStore
```

- [ ] **Step 1: Write failing tests** — open sets the value, close nulls it, subscribers fire, re-opening a different tile replaces the target.
- [ ] **Step 2: Run tests, verify FAIL** (module not found).
- [ ] **Step 3: Implement** — module-level `let target: TileDetailTarget | null = null`, listener `Set`, `subscribe`/`getSnapshot`, `useSyncExternalStore` hook. Header comment must state: "Single seam for opening tile detail pages. When real routing lands, this file's internals become router params; call sites never change." Model on `src/lib/open-settings-store.ts` but as a LIVE value, not one-shot.
- [ ] **Step 4: `bun run typecheck && bun run test` → PASS.**
- [ ] **Step 5: Commit** `feat(control-center/web): tile-detail-store seam` and push (`git push --no-verify`).

### Task 2: detail types + registry + TileDetailHost + stories

**Files:**
- Create: `src/components/tiles/detail/types.ts`, `src/components/tiles/detail/registry.ts`, `src/components/tiles/detail/TileDetailHost.tsx`, `src/components/tiles/detail/TileDetailHost.stories.tsx`

**Interfaces (Produces):**

```ts
// types.ts
import type { ReactNode } from "react";
export interface DetailVariant {
  slug: string;   // stable kebab-case, matches old modal variant slugs
  label: string;  // switcher pill label
  render: () => ReactNode;  // bare page content — NO <Modal>
}
export interface TileDetailPageEntry {
  kind: "page";
  tileId: string;
  title: string;          // header title, matches tile label
  requiresPin?: true;     // PIN-gated (Activity)
  defaultSlug: string;
  // Live-data hook, called only while the page is open (active-only child), same
  // contract as the old TileModalEntry.useVariants.
  useVariants: () => { variants: DetailVariant[]; loading: boolean };
}
export interface TileDetailActionEntry {
  kind: "action";
  tileId: string;
  run: () => void;        // e.g. Frontend Logs → openSettingsOnPage("logs")
}
export type TileDetailEntry = TileDetailPageEntry | TileDetailActionEntry;

// registry.ts
export function getTileDetailEntry(tileId: string): TileDetailEntry | undefined;
// plus: const ENTRIES: TileDetailEntry[] — starts EMPTY, grows per task.
// Final-state completeness is enforced in Task 12 (cleanup) by typing the
// registry as covering every TILE_REGISTRY id.

// TileDetailHost.tsx
export function TileDetailHost(): JSX.Element | null;  // no props — reads useTileDetail()
```

**Host requirements (copy mechanics — read `SettingsPage.tsx:100-156`, `SettingsButton.tsx:21-92`, `TileModalHost.tsx`, `VariantSwitcher.tsx` first):**

- Reads `useTileDetail()`; null → render null. Looks up `getTileDetailEntry(target.tileId)`; missing or `kind:"action"` → null (board handles actions).
- Key the inner active component by `tileId` so switching tiles fully remounts (fresh variant selection + fresh queries), same trick as `TileModalHost.tsx:28`.
- PIN: if `entry.requiresPin`, run the two-flag gate before mounting the page: `gateOpen`/`unlocked` local state; on target change reset both; render `<PinGateModal open={gateOpen} title={entry.title} onClose={() => { setGateOpen(false); closeTileDetail(); }} onSuccess={() => { setGateOpen(false); setUnlocked(true); }} />`; only render the page once `unlocked`. Gate must fully unmount before the page mounts (no double-overlay flash) — see `SettingsButton.tsx:22-26`.
- Page chrome, exactly the Settings portal pattern (`SettingsPage.tsx:136-156`): `createPortal` to `document.body`, `position: fixed; inset: 0; zIndex: 100; background: var(--bg); color: var(--ink); fontFamily: var(--ui)`, safe-area `padding*` (not inset), `boxSizing: border-box`, `overflow: hidden`.
- Inside: a header row (padding 24, `BackButton` from `src/components/settings-page/blocks.tsx` wired to `closeTileDetail()`, then an `<h1>`-styled title matching Settings' header idiom) above a content region `flex: 1; overflow: auto; padding: 24px` with NO max-width cap (variants carry their own 920px cap per the recipe).
- Lifecycle effects, all gated on being open: `registerOpenModal(() => closeTileDetail())` (ref-routed like `SettingsPage.tsx:102-107`), Escape-to-close, interaction logging `interaction("modal", "open"/"close", \`detail.${entry.title}\`)`.
- Variants: call `entry.useVariants()` inside the active-only child (hooks rules — see `TileModalHost.tsx:31-32`). Loading → full-page skeleton (reuse `Skeleton` from `@/components/ui`, layout like `TileModalHost.tsx:47-54` but inside the page shell, not a Modal). Ready → render active variant's `render()` in the content region; when `variants.length > 1` also render the existing `<VariantSwitcher variants activeSlug onSelect>` — import from `../modals/VariantSwitcher`, retyped to accept `{ slug, label }[]` (widen its prop type to `Pick<LiveVariant, "slug" | "label">[]` so both old and new callers typecheck during the transition). Honor `target.variantSlug` as the initial slug when present, else `entry.defaultSlug`.
- Do NOT port the `modal-no-enter`/`ENTER_MS` hack.

**Stories:** `TileDetailHost.stories.tsx` needs three stories driven by fixture entries (stories may use fixtures; the no-fake-data rule applies to app runtime wiring): single-variant page (switcher hidden), multi-variant page (switcher visible, swapping works), and `requiresPin` page (gate first). Follow an existing stories file for the CSF idiom (e.g. any `*.stories.tsx` under `components/`). Drive open state by calling `openTileDetail("tile_x")` in a story decorator/effect.

- [ ] **Step 1:** Write `types.ts`, empty `registry.ts`, then `TileDetailHost.tsx` per above.
- [ ] **Step 2:** Write the three stories; run Storybook test suite the way the repo does (check `bun run test` covers stories; else `bun run --cwd products/control-center/storybook test` per its package.json).
- [ ] **Step 3:** `bun run typecheck && bun run test && bun run lint` → PASS.
- [ ] **Step 4: Commit** `feat(control-center/web): TileDetailHost full-page shell + detail registry` and push.

### Task 3: Board wiring — new path first, old path fallback

**Files:**
- Modify: `src/components/Board.tsx` (tap capture ~`:816-863`, keyboard ~`:973-980`, host mount ~`:1028`)

**Interfaces (Consumes):** `openTileDetail`, `useTileDetail` (Task 1); `getTileDetailEntry`, `TileDetailHost` (Task 2).

- [ ] **Step 1:** Add a shared `activateTile(entry: TileRegistryEntry)` callback used by BOTH the plain-tap branch and keyboard activation:

```ts
// Recenter + open the tile's detail. New detail registry wins; tiles not yet
// migrated fall back to the old modal registry; an "action" entry (Frontend
// Logs) runs its deep link instead of opening a page.
const activateTile = useCallback(
  (entry: TileRegistryEntry) => {
    glideToTile(entry);
    const detail = getTileDetailEntry(entry.id);
    if (detail) {
      if (detail.kind === "action") detail.run();
      else openTileDetail(entry.id);
      return;
    }
    const modal = getTileModalEntry(entry.id);
    if (modal) setActiveModal(modal);
  },
  [glideToTile],
);
```

- [ ] **Step 2:** In `onTileClickCapture`, compute `ownsTap` as today BUT exclude tiles that now have a detail entry: `const migrated = Boolean(getTileDetailEntry(entry.id)); const ownsTap = (!migrated && entry.ownsTap) || Boolean((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR));` — inner controls still swallow taps; migrated tiles ignore stale `ownsTap`. Log `kind: ownsTap ? "control" : "open-detail"`. Plain tap calls `activateTile(entry)`.
- [ ] **Step 3:** Keyboard handler: replace the `if (entry.ownsTap) return;` early-return with the same `migrated` check (`if (!migrated && entry.ownsTap) return;`), and call `activateTile(entry)` on Enter/Space. (Fully unblocked in cleanup when `ownsTap` dies.)
- [ ] **Step 4:** Mount `<TileDetailHost />` next to `<TileModalHost …/>` at `Board.tsx:1028`. TileDetailHost registers with `modal-open-store`, so the existing `modalOpen` freeze/bail logic covers it automatically.
- [ ] **Step 5:** `bun run typecheck && bun run test` → PASS. Behavior is unchanged (registry still empty).
- [ ] **Step 6: Commit** `feat(control-center/web): board routes taps through tile-detail registry` and push.

### Task 4: Convert Tesla (canonical worked example)

**Files:**
- Modify: `src/components/tiles/modals/wiring/tesla.tsx`; `src/components/tiles/modals/TeslaModalVehicleVitals.tsx`, `TeslaModalLiveMapCommand.tsx`, `TeslaModalChargeSession.tsx`, `TeslaModalRangeReach.tsx`; their `*.stories.tsx`; `src/components/tiles/detail/registry.ts` (add entry); `src/components/tiles/modals/registry.ts` (remove entry).

Apply the Conversion Recipe. Wiring end state:

```ts
export const teslaDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_tesla",
  title: "Tesla",
  defaultSlug: "vehicle-vitals",
  useVariants: useTeslaVariants,   // unchanged hook body, variants now render: () => <TeslaModal… {...data} />
};
```

Variant components lose `open`/`onClose`; e.g. `TeslaModalChargeSession` renders `<div style={{ maxWidth: 920, margin: "0 auto" }}>…same content…</div>`. Keep the `ChargeSample` export and `useChargeSamples` behavior untouched.

- [ ] Recipe steps 1–7 (typecheck, test, stories, commit `feat(control-center/web): tesla detail goes full-page`, push).

### Task 5: Convert Clock + Weather

Same recipe. Wiring `modals/wiring/clock.tsx` (variants in `ClockModalSolarDayArc/TimeOfDayRhythm/CountdownHorizon/WorldClocks`) → `clockDetailEntry` (title "Clock"); `modals/wiring/weather.tsx` (`WeatherModalSunDayArc/WeekOutlook/ComfortBreakdown/HourlyTempCurve`) → `weatherDetailEntry` (title "Weather Now"). One commit per tile.

- [ ] Clock converted, green, committed, pushed.
- [ ] Weather converted, green, committed, pushed.

### Task 6: Convert Network + Next 12 Hours

Same recipe. `modals/wiring/network.tsx` → `networkDetailEntry` ("Network"). `modals/wiring/next12hours.tsx` → `next12HoursDetailEntry` ("Next 12 Hours") — **ThermalDayArc returns `<Modal>` from TWO branches (~`:181`, `:254`); convert both.** One commit per tile.

- [ ] Network converted, green, committed, pushed.
- [ ] Next 12 Hours converted, green, committed, pushed.

### Task 7: Convert Climate + Upcoming

Same recipe. `modals/wiring/climate.tsx` → `climateDetailEntry` ("Climate · A/C"). `modals/wiring/events.tsx` → `eventsDetailEntry` ("Upcoming") — **`EventsModalManage.tsx` is a WRITE path (event CRUD) with an internal confirm flow; keep every handler and confirm intact, only swap the outer chrome.** One commit per tile.

- [ ] Climate converted, green, committed, pushed.
- [ ] Upcoming converted, green, committed, pushed. All 7 board-registry tiles now full-page; `modals/registry.ts` ENTRIES is empty (leave the file for cleanup).

### Task 8: Group 2, singles — Deploys, Schedules, Sound, Notifications, TV Apps

For each tile, the same small surgery (one commit per tile):

1. In the tile container (e.g. `src/components/tiles/DeployTile.tsx`), delete the local modal `useState` + `<…Modal…/>` render + the "More"/"Open" button wiring that opened it (keep other in-face controls; TV Apps' face app-launch buttons stay).
2. Move the modal body component to a bare page component per the Conversion Recipe steps 1–4 (strip `<Modal>`, keep content; files: `ExpandedSchedulesModalView.tsx`, `GroupsModalView.tsx`, `ExpandedNotificationCenterModalView.tsx` (tabs stay internal), `AllAppsModal.tsx`, Deploys' modal body in `DeployTile.tsx`/sibling).
3. Add a `kind:"page"` entry (single variant, slug `"detail"`, label = tile label) to `detail/registry.ts`. Data wiring: whatever props the tile passed the modal now come from a `useVariants` hook colocated in a new `detail/wiring/<tile>.tsx` module, following the pattern of `modals/wiring/tesla.tsx` (live tRPC hooks inside, never fixtures).
4. Remove `ownsTap: true` from that tile's entry in `src/lib/tile-registry.ts`.
5. Stories updated; typecheck + test; commit `feat(control-center/web): <tile> detail goes full-page`; push.

- [ ] Deploys · [ ] Schedules · [ ] Sound · [ ] Notifications · [ ] TV Apps — each converted, green, pushed.

### Task 9: Group 2, two-variant pages — TV, Quick Play

Same surgery, but the tile's TWO modals become two variants of one page entry:

- TV (`src/components/media/TvNowPlayingTile.tsx`): variants `{slug:"transport", label:"Now Playing"}` from `TransportScrubModal.tsx` body and `{slug:"remote", label:"Remote"}` from `TvRemoteModal.tsx` body; `defaultSlug:"transport"`; title "TV". The in-tile buttons that opened each modal now call `openTileDetail("tile_tv", "transport" | "remote")`.
- Quick Play (`src/components/media/QuickPlayTile.tsx`): variants `{slug:"favorites", label:"Favorites"}` (`FavoritesModal.tsx`) and `{slug:"spotify", label:"Spotify"}` (`SpotifyModal.tsx`); `defaultSlug:"favorites"`; title "Quick Play".
- Drop `ownsTap` for both in `tile-registry.ts`.

- [ ] TV converted, green, committed, pushed.
- [ ] Quick Play converted, green, committed, pushed.

### Task 10: Controls

Same surgery: `src/components/tiles/ControlsTile.tsx` loses its "More" modal state; `ExpandedControlsModalView.tsx` body becomes the single-variant page (title "Controls"). Per the spec's no-exceptions decision, the remote-style content is a page now — content unchanged. Drop `ownsTap`.

- [ ] Controls converted, green, committed, pushed.

### Task 11: Activity fold-in + DogCam/DogMode + Frontend Logs

**Files:**
- Modify: `src/components/tiles/WakesTile.tsx` (delete hand-wired `PinGateModal` + `ActivityPage` mount + local state), `src/components/ActivityPage.tsx` (export a body component the variant can render — keep the standalone page file if other callers exist, else convert it to the bare body), `src/components/tiles/DogCamTile.tsx`/`DogCamTileView.tsx`, `src/components/tiles/DogModeTileView.tsx`, `src/lib/tile-registry.ts` (drop `ownsTap` from `tile_wakes`, `tile_felogs`), `src/components/tiles/detail/registry.ts`.

- [ ] **Step 1:** Activity: registry entry `{ kind:"page", tileId:"tile_wakes", title:"Activity", requiresPin: true, defaultSlug:"activity", useVariants }` where the single variant renders the ActivityPage body (its data hooks move into the variant/wiring so they only run while open). Delete WakesTile's own gate/page wiring. The host's PIN path (Task 2) now provides the gate with title "Activity".
- [ ] **Step 2:** DogCam + DogMode: one honest single-variant page each — current state the tile already shows (live/rec toggle state; DogMode's preview arm state) plus the existing truthful "not yet connected to the house" copy. NO new features, NO fabricated data; reuse the view components' real props.
- [ ] **Step 3:** Frontend Logs: registry entry `{ kind:"action", tileId:"tile_felogs", run: () => openSettingsOnPage("logs") }` (import from `src/lib/open-settings-store.ts`); simplify `FrontendLogsTile.tsx` if its own button duplicated this. Board action path (Task 3) runs it; the Settings PIN gate still applies via `SettingsButton`.
- [ ] **Step 4:** typecheck + test; commit `feat(control-center/web): activity/dogcam/dogmode/logs join detail registry` and push.

### Task 12: Cleanup — delete the old path

**Files:**
- Modify: `src/components/Board.tsx`, `src/lib/tile-registry.ts`, `src/components/tiles/detail/registry.ts`
- Delete: `src/components/tiles/modals/TileModalHost.tsx`, `src/components/tiles/modals/registry.ts`, `src/components/tiles/modals/types.ts` (`LiveVariant`/`TileModalEntry`; move `VariantSwitcher`'s prop type into `detail/types.ts` and update its import)

- [ ] **Step 1:** `tile-registry.ts`: delete the `ownsTap` field and every remaining usage.
- [ ] **Step 2:** `Board.tsx`: delete `activeModal` state, `openModalFor`, the `getTileModalEntry` fallback in `activateTile`, the `<TileModalHost>` mount, and the `migrated`/`ownsTap` conditionals — plain tap and Enter/Space both just run `activateTile`; inner-control taps still short-circuit via `INTERACTIVE_SELECTOR`.
- [ ] **Step 3:** `detail/registry.ts`: enforce completeness — derive `type KnownTileId` from a union of the 19 ids (or assert `TILE_REGISTRY.every(t => getTileDetailEntry(t.id))` in a unit test) so a future tile without an entry fails CI instead of silently no-oping. A unit test is preferred (registry ids are strings at runtime); add `src/components/tiles/detail/__tests__/registry.test.ts` asserting every `TILE_REGISTRY` id resolves.
- [ ] **Step 4:** `bun run typecheck && bun run test && bun run lint && bun run knip` — knip should now be clean of the deleted modal files (the pre-existing knip failure may remain; confirm no NEW hits from this migration).
- [ ] **Step 5:** Commit `refactor(control-center/web): delete tile modal path, ownsTap` and push.

### Task 13: Prod verification

- [ ] **Step 1:** `gh run list --branch main --limit 5` / `gh run watch <id>` until the deploy for the final commit is green.
- [ ] **Step 2:** Confirm the panel picked up the build: query `frontend_log` on `control-center-1` (psql via kubectl exec) for rows with the new git `sha`/`build`, per repo CLAUDE.md Debugging.
- [ ] **Step 3:** Real-panel sanity: from `frontend_log`, confirm `interaction` rows with `kind: "open-detail"` appear after a tap (or, if none yet, at minimum no error-level rows from the new build).
- [ ] **Step 4:** ntfy the user: shipped + verification summary.
