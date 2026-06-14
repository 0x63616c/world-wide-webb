# WorldWideWebb Design System

> **WorldWideWebb — A new way to manage your life with AI.**

This is the design system for **Control Center**, WorldWideWebb's flagship product:
a smart-home **wall-panel dashboard** that runs full-screen on a fixed iPad Pro
panel mounted on the wall. It renders a pannable bento board of live tiles —
climate, lighting, weather, network, Tesla, dog cam, media — driven by an
AI-managed home backend. The aesthetic is **"Vercel-black"**: pure neutral black
surfaces, a Geist-style foreground ramp, one electric-blue accent, and crisp
mono numerals. It reads like premium developer infrastructure for your home.

This system packages that language — tokens, fonts, components, and a full
dashboard recreation — so you can design new screens, decks, and marketing
assets that look unmistakably WorldWideWebb.

## Sources

Built by reading the real product code. Explore these to go deeper:

- **`0x63616c/control-center`** — https://github.com/0x63616c/control-center
  The Control Center monorepo. The web board lives under
  `products/control-center/web/src`; design tokens in `…/styles/tokens.css`,
  UI primitives in `…/components/ui`, tiles in `…/components/tiles`.
- **`worldwidewebbco/headquarters`** — https://github.com/worldwidewebbco/headquarters
  A related WorldWideWebb homelab workspace (Next.js). Context only.

Everything below is lifted from that source. If you have access, read the repos
for the authoritative implementation.

---

## CONTENT FUNDAMENTALS

How WorldWideWebb writes copy. The panel speaks like a quiet, confident OS — never chatty.

- **Voice: terse, factual, system-level.** Labels are nouns or short noun
  phrases: "Weather Now", "Next 12 Hours", "Upcoming", "Sound System",
  "Climate · A/C". No verbs-as-CTAs unless it's an action ("more", "All").
- **Casing.** Tile titles and labels use **Title Case** ("Quick Play", "Dog
  Cam"). Micro-labels / captions are **UPPERCASE with wide tracking** ("FEELS",
  "HUMIDITY", "RANGE", "CAM 01 · LIVING ROOM"). On/off states are uppercase mono
  ("ON" / "OFF").
- **Numbers are the headline.** The loudest element on most tiles is a number —
  the time, a temperature, a percentage, a day-count. Always set in **Space
  Mono**, always with a small unit suffix in a muted color (`72°F`, `+31 mi/hr`,
  `8ms`, `74%`).
- **Separators.** A middot ` · ` joins related fragments ("S2 · E7 · …",
  "Climate · A/C", "Home · Garage"). Arrows for direction (`↓ 42.8 GB`,
  `↑ 8.1 GB`, `H 67°` / `L 54°`).
- **No filler, no fallbacks.** When data is missing the UI **shimmers or shows
  an error and recovers** — it never invents a value or shows "—" / "N/A".
  This is a product principle, not just a style: never fake data.
- **First / second person:** essentially none on the panel itself. The one
  exception is the warm greeting on the hero clock ("Good Evening") — sentence
  feel, no name. Marketing voice may use "you" ("manage **your** life").
- **No emoji.** Iconography carries all symbolic weight (see ICONOGRAPHY). Status
  is shown with color + a dot, never an emoji.
- **Vibe:** calm, precise, a little nerdy-luxurious. Think a beautifully
  instrumented dashboard, not a consumer smart-home app.

Examples: `GOOD EVENING` · `9:24 PM` · `Partly Cloudy` · `Charging · +31 mi/hr`
· `Webb-5G · 8ms` · `2 days · Dentist · Dr. Lee · Mission`

---

## VISUAL FOUNDATIONS

- **Color.** Pure-neutral grayscale surfaces (R=G=B, **no blue tint**) stacked
  darkest→lightest: `--bg #000` (the void) → `--tile #0a0a0a` → `--tile-2 #111`
  → `--nest #181818`. Text is a 3-step Geist ramp (`--ink #ededed`, `--ink-2
  #a1a1a1`, `--ink-3 #6e6e6e`). **One accent only:** Vercel blue `--acc #0070f3`,
  used for anything live/active/selected, plus its dim fill (`14%`) and line
  (`45%`). **Amber `#f4c063`** is the lone secondary accent — attention only
  (unlocked, warnings). Everything else is grayscale.
- **Type.** Two families: **Space Grotesk** (UI + display, weights 300–700) and
  **Space Mono** (every numeral / telemetry value, 400 & 700). Tracking is
  deliberately tight — display numerals go to **-0.05em**; UI text sits at
  -0.01em. Captions invert this: **UPPERCASE at +0.16em**. `font-display: block`
  (no FOUT). Antialiased everywhere.
- **Backgrounds.** Always pure black `#000`. **No gradients on surfaces**, no
  imagery, no patterns — the only gradients are functional (slider fills, the
  Tesla charge bar, a subtle radial inside a camera/map feed). A faint scanline
  texture (`repeating-linear-gradient`, ~2% white) appears only inside live feed
  shells.
- **Cards / tiles.** The signature object. `--tile` surface, **1px translucent
  hairline border** (`--hair`, white 7%), **20px radius**, and a two-part
  shadow: a 1px inset top highlight + a soft deep drop
  (`0 10px 30px -18px rgba(0,0,0,.8)`). Borders are the only borders in the
  system — there are no solid-color or colored-left-border cards.
- **Radii nest.** 20px tile → 15px control cell → 14px feed → 11px chip → 10px
  well → 999px pill/switch/slider.
- **Shadows.** Subtle and dark. Tile shadow (above), modal shadow
  (`0 24px 64px -16px rgba(0,0,0,.7)`). The **only colored shadow** is the accent
  glow on active controls (`0 0 26px -6px rgba(0,112,243,.5)`).
- **Hover.** Borders brighten one step (`--hair` → `--hair-2`). No movement, no
  background change on plain tiles. Taps/chips that are "on" fill `--acc-dim`
  with an `--acc-line` border and accent text.
- **Press / active.** Sliders use `cursor: grab/grabbing`. Active toggles snap to
  the accent fill + glow. No scale-down press effect on tiles.
- **Borders & dividers.** 1px `--hair`. A `.divider` is a 1px `--hair` rule used
  to separate a tile's hero region from its metric footer.
- **Transparency & blur.** Borders and accent fills are translucent white/blue;
  the modal backdrop is `rgba(0,0,0,.55)`. **No backdrop-blur** — the system
  stays crisp and flat, not glassy.
- **Motion.** Restrained. Modal enters with a 220ms rise + scale
  (`cubic-bezier(.16,1,.3,1)`); backdrop fades 180ms. The switch knob springs
  with a slight overshoot (`cubic-bezier(.4,1.3,.5,1)`). Three ambient loops:
  a 2.4s **pulse** ring on the live dot, a 1.6s **shimmer** on skeletons, a slow
  10s **spin** on the active fan glyph. Everything honors
  `prefers-reduced-motion`. No bounces, no decorative parallax.
- **Imagery.** There is essentially none — this is a data UI. Where a feed would
  be (dog cam, Tesla map) the system shows a dark radial placeholder with a
  scanline overlay, a glyph, and mono corner labels. Any real imagery should be
  cool/dark and sit behind a black surface.
- **Layout.** A square-cell bento grid: 12 columns, an **18px gutter** (= the
  edge margin), square cells (~94px on the panel). Tiles span whole cells; the
  board is a fixed wall-panel world (1366×1024), **never responsive** — it pans
  rather than reflows. Generous internal padding (22px default, 28px hero).

---

## ICONOGRAPHY

- **One library: [Lucide](https://lucide.dev).** The product imports
  `lucide-react`; this system uses the same glyphs via the Lucide CDN.
- **A small, curated vocabulary** — not a free-for-all (it's a fixed panel). The
  set: `sun, moon, cloud, cloud-sun, lamp, bulb, bulb-off, fan, thermo, car,
  bolt, lock, unlock, wifi, pin, cam, dog, calendar, plus, bell, chevron, up,
  down, sparkles, globe, speaker, apps`. Adding an icon is a deliberate act.
- **House conventions, enforced in one place** (`components/core/Icon`):
  **stroke width 1.7**, `currentColor` stroke, square sizing, `aria-hidden`.
  Icon color follows state — `--ink-2` at rest, `--acc` when active.
- **Sizes.** ~19px in tile headers, 26px in control cells, 60–76px as a hero
  weather/feed glyph (lighter stroke ~1.3 at hero scale).
- **No emoji. No unicode-as-icon** except a literal `×` for the modal close and
  directional arrows (`↓ ↑ – °`) inside mono telemetry strings.
- **To render icons** on any page, include the Lucide CDN script (see any card),
  then use the `Icon` component, or `<i data-lucide="…">` + `lucide.createIcons()`
  in plain HTML.
- **Brand mark:** `assets/app-icon.png` — a sculptural white form on a black
  rounded square. Use it on pure black; pair with the wordmark *WorldWide**Webb***
  set in Space Grotesk (semibold, with "Webb" bold).

---

## INDEX

**Root**
- `styles.css` — the single entry point consumers link. `@import`s everything below.
- `README.md` — this guide.
- `SKILL.md` — Agent-Skill manifest for downloading/using this system.

**`tokens/`** — design tokens & base CSS (all reached from `styles.css`)
- `fonts.css` — `@font-face` for Space Grotesk Variable + Space Mono.
- `colors.css` — surfaces, foreground ramp, accent, amber, status, semantic aliases.
- `typography.css` — families, weights, size scale, tracking, line-heights.
- `spacing.css` — spacing scale, grid, radii, shadows, motion.
- `primitives.css` — ported utility classes (`.tile`, `.pill`, `.chip`, `.sw`,
  `.dot`, `.range`, `.cap`, `.mono`, feed/scanline) + keyframes.

**`components/`** — reusable React primitives (bundled to `window.WorldWideWebbDesignSystem_9ddf08`)
- `core/` — `Icon`, `Tile`, `TileHeader`, `Pill`, `Stat`, `StatusDot`, `Skeleton`
- `controls/` — `Switch`, `Chip`, `Button`, `ControlTap`
- `feedback/` — `Modal`

**`ui_kits/control-center/`** — the dashboard recreation
- `index.html` — the interactive wall-panel board (tap controls, drive climate,
  open the expanded modal). Composed from the primitives.
- `tiles.jsx`, `controls.jsx`, `board.jsx` — the tile + board source.

**`foundations/`** — specimen cards shown in the Design System tab
- Colors (surfaces, foreground, accent, amber/status, hairlines), Type
  (families, display, UI scale), Spacing (radii, scale, shadows), Brand (logo,
  tile anatomy).

**`assets/`**
- `app-icon.png` — the brand mark.
- `fonts/` — Space Grotesk Variable, Space Mono 400/700 (woff2).

---

## Using it

Link the stylesheet and load the bundle:

```html
<link rel="stylesheet" href="styles.css" />
<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
<!-- React 18 + ReactDOM + Babel (pinned) -->
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { Tile, TileHeader, Stat, Icon } = window.WorldWideWebbDesignSystem_9ddf08;
  // …compose tiles…
  lucide.createIcons();
</script>
```

Everything is driven by CSS custom properties — reference `var(--acc)`,
`var(--tile)`, `var(--ink-2)` etc. rather than hard-coding values.
