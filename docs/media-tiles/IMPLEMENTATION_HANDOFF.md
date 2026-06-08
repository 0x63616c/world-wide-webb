# Implementation Handoff — Media / Entertainment Control Center

**Target repo:** `0x63616c/control-center` → `apps/web` (React + Vite, TanStack Router/Query, tRPC).
**What this is:** the spec for a set of **media/entertainment tiles** (and their detail modals) to add to the existing wall‑panel dashboard. Build them as real React components in `apps/web/src/components`, reusing the existing primitives and tokens — **do not** copy the HTML prototypes verbatim.

---

## 0. How to use this doc

1. These tiles slot into the existing **1366×1024 wall panel** board (dark, pannable, square‑cell grid, touch‑first, never scrolls).
2. **Reuse the existing design system** — it already has everything you need:
   - Tokens: `apps/web/src/styles/tokens.css` (surfaces, hairlines, ink ramp, the single blue accent, radii, the `.tile / .pill / .dot / .sw / .range / .chip / .tap / .cap` classes, shimmer/pulse keyframes).
   - Primitives: `apps/web/src/components/ui/` — `Tile`, `TileHeader`, `Pill`, `Stat`, `StatusDot`, `Skeleton`, `Chip`, `ControlTap`, `Modal`, `BorderProgressRing`. Icon set: `apps/web/src/components/Icon.tsx`.
   - Build each new tile with `<Tile>` + `<TileHeader>` and wrap data fetching in the existing `TileBoundary` (it resolves a query to `loading | ready | error` and renders `<Skeleton>` while pending — **never render a fake value**).
3. **Fidelity: high.** Match the prototype layouts pixel‑for‑pixel using the tokens below. Every numeral uses the mono face; every tiny label is uppercase `.cap` (10.5px, `letter-spacing .16em`, `--ink-3`).
4. **Prototype references** (in this project — visual source of truth, runnable):
   - `Chosen Set.html` — the picked direction for every card + variations + what's in/out.
   - `Now Playing.html`, `Rooms — Vertical Mixer.html`, `App Launcher.html`, `Quick-Play.html` — per‑card explorations.
   - `Component Library.html` — the ported DS primitives in every state.
   - Source for all of the above: `kit/kit.jsx` (tokens/primitives), `kit/nowplaying.jsx`, `kit/rooms-mixer.jsx`, `kit/applauncher.jsx`, `kit/quickplay.jsx`.

---

## 1. Design tokens (already in `tokens.css` — listed for reference)

```
--bg:#000000  --tile:#0a0a0a  --tile-2:#111111  --nest:#181818
--hair:rgba(255,255,255,.07)  --hair-2:rgba(255,255,255,.12)
--ink:#ededed  --ink-2:#a1a1a1  --ink-3:#6e6e6e
--acc:#0070f3  --acc-2:#0061d5
--acc-dim:rgba(0,112,243,.14)   /* fill behind active items */
--acc-line:rgba(0,112,243,.45)  /* border on active items   */
--acc-glow:0 0 0 1px rgba(0,112,243,.4), 0 0 26px -6px rgba(0,112,243,.5)
--amber:#f4c063                 /* rare warning only          */
--r:20px                        /* card radius; nested controls 12–14px */
font ui:   "Space Grotesk", system-ui      (all UI text)
font mono: "Space Mono", ui-monospace       (ALL numerals: time, %, volume, duration)
```

**Tile sizes** (cell ≈ 94.33px square, 18px gap). `cols×rows → W×H`:
`3×2 →319×207 · 4×2 →431×207 · 3×3 →319×319 · 4×3 →431×319 · 3×4 →319×431 · 5×3 →544×319 · 6×4 →656×431`.

**Modal panel:** centered on a dim scrim (`rgba(0,0,0,.55)`, click or `Esc` closes). Panel = `--tile`, `1px --hair`, radius 20, shadow `0 24px 64px -16px rgba(0,0,0,.7)`; header row = title + 34px round close button. Use the existing `Modal` primitive; it portals to `<body>` so dragging inside it never pans the board.

**House rules:** black stage; cards `--tile` + `1px --hair` + radius 20 + 18–20px padding; no shadows on cards (only the floating modal); active/selected = `--acc-dim` fill + `--acc-line` border + a small `--acc` dot; dark scrollbars only.

---

## 2. Backends & data model (design against these real fields — no invented capabilities)

### Sonos (5 zones)
`Living Room` (Beam) · `Desk` (Era 300 stereo pair) · `Bedroom` (Era 300) · `Bathroom` (Era 100) · `Kitchen` (Era 100 SL).
Per room: `volume 0–100`, `mute`, `state` (PLAYING/PAUSED/STOPPED), `source` (Line‑in / TV / a streaming service / idle), and **group topology** (which rooms are bonded + who is coordinator — changes live). Whole‑house **group volume** is one fader.
⚠️ Now‑playing art/title/artist exist **only when the source is a streaming service**. **Line‑in and TV expose no track metadata — label them by source.**

### Apple TV (Home Assistant `media_player` + `remote`)
`state` (playing/paused/idle), `app_name`, `media_title`, `media_artist`, `media_position`, `media_duration` (seconds → `mm:ss`), `source_list` of **27 installed apps**.
Controls: play/pause/stop, next/previous, **seek** (scrub anywhere), launch app, power on/off, full **D‑pad** (up/down/left/right/select, menu, home, app‑switcher). **No mute on Apple TV** — volume routes through Sonos/HomePod. A HomePod and a Spotify endpoint are also visible as media players.

### Sample live state (use these exact values in dev/mocks)
Apple TV → **YouTube**, *“We Investigated a New Designer Drug”* by **fern**, `media_position 310 / media_duration 1643` (5:10 / 27:23), **paused**.
Desk + Bedroom bonded on **Line‑in** (Desk = coordinator), both playing. Living Room (Beam) idle; Bathroom, Kitchen idle.
Volumes: LR 70 · Desk 66 · Bedroom 68 · Bathroom 68 · Kitchen 53.
App logos to show with real marks: YouTube, Netflix, Prime Video, Disney+, Hulu (+ a “more” affordance for the full 27).

---

## 3. What to build (final decisions)

| # | Card | Tile | Modals to ship | Notes |
|---|------|------|----------------|-------|
| 1 | **TV Now Playing** | **A** Horizontal split (4×3) | Transport & Scrub · TV Remote | source‑aware states; Output Routing **dropped** |
| 2 | **Sound System** | **V1** Grouped lockable faders (4×3) | Mixer · Per‑room Source | renamed from “Rooms”; Group Builder **dropped** |
| 3 | **TV Apps** | **L3** Hero app (4×2) | All Apps (full‑color) | mono modal **dropped** |
| 4 | **Quick‑Play** | **Q1** Horizontal artwork rail (4×2) | Favorites · Spotify | — |
| 5 | **Scenes** | — | — | **Parked. Do not build yet.** |

---

## 4. TV Now Playing  *(tile A · 4×3 · 431×319)*

**Header:** `tv` icon (19px, `--ink-2`) + title **“TV Now Playing”** (17.5px/600/‑0.015em) + status pill pushed right.
Pill: `PLAYING` = accent (`--acc-dim`/`--acc-line`/`--acc` dot); `PAUSED` = neutral (`--tile-2`/`--ink-2`).

**Body (vertically balanced — the gap below the header equals the gap below the scrub):**
- **Artwork** 148×148, radius 14, `1px --hair`; app brand glyph bottom‑left (20–22px). Streaming only; for line‑in/TV use a neutral `--tile-2` block with a source glyph.
- **Meta column** (vertically centered against the artwork): source line = app glyph + `app_name` + `·` + `media_artist`; **title** 18px/600, 3‑line clamp; transport cluster = prev (40) · play/pause (48, primary accent, `--acc-glow`) · next (40), round buttons.
- **Scrub** below the row: 4px track `--nest`, fill `--acc`, white knob 14px; `media_position` (accent) left, `media_duration` (`--ink-3`) right, both mono 12px.

### Source‑aware states (drive off `source` + `state`)
| State | Condition | Show | Hide / change |
|---|---|---|---|
| Streaming · playing | streaming source, state=playing | art, app+artist, title, scrub, transport (pause icon) | — |
| Streaming · paused | streaming, paused | same; play icon; `PAUSED` pill | — |
| Line‑in | source=Line‑in | neutral art, `LINE‑IN` pill, room/device label, **volume** control | **no title/artist, no scrub** (no position) |
| TV | source=TV | neutral art, `TV` pill, room/device label, volume | no metadata, no scrub |
| Idle | state=idle/stopped | “Nothing playing” + hint | no transport/scrub |
| Loading | query unresolved | `<Skeleton>` shimmer (art block + 2 text lines + scrub bar) | never a fake value |

### Modal A‑1 — Transport & Scrub  *(880×640)*
Big artwork 340×340 (app chip bottom‑left) · right column: state pill, title 30px/600, artist 16px `--ink-2`, **draggable** scrubber (pointer anywhere on the track → `seek(position)`, `mm:ss` under it), transport row = shuffle(50)·prev(56)·**play/pause(72 primary)**·next(56) + a volume slider (routes to the active Sonos/HomePod output). For line‑in/TV: replace the scrubber with a “live feed — no seek” note and reduce transport to play/pause(+stop).

### Modal A‑2 — TV Remote (D‑pad)  *(880×640)*
Left: now‑playing strip (art + app + title + `mm:ss`) → Playback keys (prev / play‑pause / next) → Quick keys (power, search, app‑switcher). Right: **D‑pad** — back & menu on top; a 240px round pad with up/down/left/right + center **OK**; home & power below. Map to the `remote` entity. **No mute control** (note: “volume routes through Sonos / HomePod”).

---

## 5. Sound System  *(renamed from “Rooms”; tile V1 · 4×3)*

**Header:** `speaker` icon + **“Sound System”** + a **global link** button top‑right — icon‑only 38px padlock; accent (`--acc-dim`/`--acc-line`) when engaged. Engaged = *link all rooms*.

**Body — two panels that fill the width** (flex proportional to each group’s room count; faders `justify-content: space-around` so they’re evenly spread):
- **Line‑in group panel:** `--acc-dim` bg, `1px --acc-line`. Cap row = `LINE‑IN` label (left) + **group lock** icon (right edge). Faders for the grouped rooms; the coordinator shows a small `COORD` sub‑label.
- **Idle / ungrouped panel:** `1px --hair`. Faders for ungrouped rooms, dimmed (`--ink-2`/dimmed fill).
- **Fader column:** mono value on top → vertical fader (8px track `--nest`, fill `--acc` when playing else `--ink-2`, white knob 18px) → room label below. Reserve the `COORD` line height on every column so panels align.

### ⭐ Gang‑lock behavior (the core interaction)
A lock can be **per‑group** or **global**. While a fader is in a *locked gang*, dragging it moves every gang member by the **same delta**, preserving their relative offsets, and the whole gang **stops when any member hits 0 or 100**.

```
gangFor(room):
  if globalLock: return ALL_ROOMS
  if room.group and groupLock[room.group]: return rooms in that group
  return [room]

setRoomVolume(room, target):           // target 0..100 from the drag
  gang  = gangFor(room)
  delta = round(clamp(target,0,100)) - vol[room]
  for r in gang:                        // clamp so nobody leaves [0,100]
      delta = max(delta, -vol[r])
      delta = min(delta, 100 - vol[r])
  for r in gang: vol[r] += delta        // integers → offsets preserved exactly
```
Example: gang at 24 & 29, push up → 25 & 30 → … → stops at 95 & 100.
Knob of a locked fader gets a 2px accent ring to signal it’s ganged.

### Modal S‑1 — Mixer  *(960×680)*
Same grouped‑panel layout at full height (faders ~270–300px). Adds:
- **Global link** icon in the modal header (top‑right, next to close).
- **Per‑group lock** icon at each group panel’s right edge.
- **Per‑room mute** — 38px button under each fader (`speaker`/`speaker‑mute` icon; `--acc-dim` when muted; muted fader fill dims).
- **Group from here (live):** a small **link** button under each fader. Tapping an ungrouped room joins it to the Line‑in group; tapping a grouped room removes it; the coordinator (Desk) is the anchor and can’t be removed. Panels reflow (flex by count) and the gang updates live. *(This replaces the dropped Group Builder — grouping now lives in the mixer.)*

### Modal S‑2 — Per‑room Source  *(960×680)*
One card per room: name + device + a `GROUPED` badge when bonded; a row of source chips — **Line‑in · TV · Spotify · AirPlay · Idle** — active chip uses `--acc-dim`/`--acc-line`/`--acc`. Writes the room’s `source`.

> Build a single `useMixer` hook holding `{ vols, member, globalLock, groupLock, mutes }` with `setRoomVolume` (above), `join/leave`, `toggleGroupLock`, `setGlobalLock`, `toggleMute`. The tile and both modals share its shape.

---

## 6. TV Apps  *(tile L3 · 4×2 · 431×207)*

**Header:** `apps` icon + **“TV Apps”** + status pill = active `app_name` (accent) or `IDLE`.
**Body:** left **hero cell** 188px wide:
- *Active app:* `--acc-dim`/`--acc-line`, large brand mark (36px) + app name + “Open · resume” with accent dot. Maps to the currently‑open Apple TV app.
- *Idle (nothing open):* neutral `--tile-2`, `tv` glyph in `--ink-3`, “Apple TV / Nothing open”.
Right: 2×2 grid of the next top apps (each a `--tile-2` cell with brand mark; tap → `launch(app)`; currently‑open app gets accent ring + dot).

**States:** active (YouTube) · switched (Netflix) · idle (empty). Drive off Apple TV `app_name`/`state`.

### Modal — All Apps  *(880×600)*
Search field (“Search 27 installed apps…”) + an “open app” chip. 6‑column grid of all `source_list` apps; **full‑color brand marks** for YouTube/Netflix/Prime Video/Disney+/Hulu (+ a tasteful 2‑letter monospace glyph for the rest); currently‑open app has `--acc-line` border + accent dot. Tap → launch. *(The monochrome treatment was evaluated and dropped — ship full‑color.)*

---

## 7. Quick‑Play  *(tile Q1 · 4×2 · 431×207)*

**Header:** `star` icon + “Quick Play” + a `FAVORITES` cap, right.
**Body — horizontal artwork rail:** a row of 90×90 cover thumbnails (radius 12, `1px --hair`), each with a 12px/600 title + 10.5px `--ink-3` subtitle below; the currently‑playing item gets a 26px accent **play badge** bottom‑right; a dashed “+more” cell ends the rail. Source = **Sonos Favorites + Spotify presets** (e.g. Morning Coffee, Deep Focus, KCRW 89.9, Jazz Vinyl, Discover Weekly, Lo‑Fi Beats). Tap a cover → play.

### Modals
- **Favorites** (880×620): 4‑col cover grid + a **target picker** chip row (`Everywhere · Living Room · Kitchen · Desk + Bedroom`) so a tap plays to the chosen zone; the playing item is badged.
- **Spotify browse** (880×620): search + target chip, then horizontal rows (“Recently played”, “Made for you”) of 124px covers. Maps to the Spotify endpoint.

---

## 8. Scenes — PARKED

Five concepts were explored (2×2 icon grid, single‑row pill bar, hero scene card, annotated list, radial dial) but **no direction is chosen — do not implement yet.** Revisit later. (Scene data would set rooms/source/volume across the house: Music Everywhere, Movie, Quiet, Off.)

---

## 9. Shared interaction notes

- **Tap targets ≥ 40px**, no hover‑only affordances (touch wall panel).
- **Draggable scrubber / faders:** use pointer events; on `pointerdown` capture, map `clientY/clientX` against the track rect to a 0–100 (or position) value, `clamp`, and write on `pointermove`; release on `pointerup`. Faders are `touch-action:none`, `cursor:ns-resize`.
- **Open/close modals:** existing `Modal` handles scrim + `Esc` + body‑portal. Tapping a tile glides it to center and opens its modal; each tile’s modals are switchable variants.
- **Skeletons over fake data:** while a query is pending, render `<Skeleton>` shimmer in the exact slot — never a placeholder value.
- **One accent only:** greyscale + the single blue. `--amber` is reserved for genuine warnings (e.g. a speaker offline).

---

## 10. Suggested file layout in the repo

```
apps/web/src/components/media/
  TvNowPlayingTile.tsx        + modals/TransportScrubModal.tsx, TvRemoteModal.tsx
  SoundSystemTile.tsx         + modals/MixerModal.tsx, PerRoomSourceModal.tsx
  TvAppsTile.tsx              + modals/AllAppsModal.tsx
  QuickPlayTile.tsx           + modals/FavoritesModal.tsx, SpotifyBrowseModal.tsx
  hooks/useMixer.ts           (gang-lock + grouping state)
  hooks/useNowPlaying.ts, useTvApps.ts, useFavorites.ts
```
Wire data through tRPC to the Sonos + Home Assistant backends; keep each tile dumb/presentational and resolve queries in a `TileBoundary` wrapper, matching the existing tiles (Clock, Weather, Tesla, Climate, Controls).

---

*Prototypes referenced here live in this project’s root + `kit/` folder and are the visual source of truth; open `Chosen Set.html` first.*
