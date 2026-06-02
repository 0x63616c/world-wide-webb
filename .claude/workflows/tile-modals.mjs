export const meta = {
  name: 'tile-modals',
  description: 'Explore + prototype ambitious detail modals for each board tile (3-5 Storybook POC variants per tile, then a recommendation)',
  whenToUse:
    'When you want to design the expanded tap-to-open detail modal for the dashboard tiles. Fans out: ideate concepts per tile, build Storybook POC variants in parallel, judge + recommend a favorite per tile. You then pick + implement the winners.',
  phases: [
    { title: 'Ideate', detail: '1 agent per tile brainstorms 3-4 grounded modal concepts' },
    { title: 'Build POCs', detail: 'parallel agent per concept builds a Storybook variant' },
    { title: 'Judge', detail: '1 agent per tile scores the variants + recommends a favorite' },
  ],
}

// ─── shared repo context handed to every agent ──────────────────────────────────
// Keeps each sub-agent grounded in the project's hard conventions so the POCs are
// consistent, conflict-free, and pass the gates. WHY repeated per-agent: agents
// have no shared memory, so the contract must travel with each prompt.
const REPO = `
PROJECT: control-center — a smart-home wall-panel dashboard, FIXED 1366x1024 (iPad Pro). apps/web = React board, apps/api = tRPC backend.
Run from repo root. Package manager is bun/bunx ONLY (never npm/npx).

THE MODAL PATTERN (study these — the Controls modal is the DONE reference):
- apps/web/src/components/ui/Modal.tsx — shared overlay. Props: { open, onClose, title, children, width?, maxHeight? }. width/maxHeight default to 640/720 but ARE TUNABLE PER MODAL (clamped to 1280x960). Size each tile's modal to its concept — a wide map can be 980+, a narrow agenda can stay 560. Body scrolls (.modal-scroll).
- apps/web/src/components/tiles/ExpandedControlsModalView.tsx — the gold-standard expanded modal. PURE view: ALL data + callbacks arrive via props, NO trpc/hooks. Composes trivially in Storybook + tests.
- apps/web/src/components/tiles/ExpandedControlsModalView.stories.tsx — story shape (title "Modals/...", fixtures, fn() callbacks).
- apps/web/src/components/tiles/TileShowcaseModal.tsx — the generic container the board currently opens on tap (renders the live tile at production size). The new detail modals will REPLACE/augment this per tile at implementation time. POCs do NOT wire into the board.

HARD CONVENTIONS (non-negotiable — gates enforce them):
- ZERO fake/hardcoded/placeholder data identifiers. A repo-wide grep for uppercase FALLBACK / PLACEHOLDER, and for DEMO_/demo_ outside two sanctioned files, MUST stay empty. Story fixtures are fine but must NOT use those tokens as identifiers.
- Design ONLY around data that genuinely exists. Ground every concept in real Home Assistant entities / existing tRPC routers + services. Do not invent data points. If a concept needs data we don't have, say so explicitly rather than faking it.
- Reuse shared primitives from apps/web/src/components/ui/ (barrel: ui/index.ts): TileHeader, Stat, Pill, Chip, Skeleton, ControlTap, StatusDot, BorderProgressRing, Modal. Do NOT re-inline headers/pills/skeletons.
- Styling: dark theme via CSS custom props in apps/web/src/styles/tokens.css (--bg --tile --tile-2 --nest --hair --hair-2 --ink --ink-2 --ink-3 --acc --amber --r --ui --mono, helper classes .cap .sec .pill .chip .range .feed .divider). Use these tokens, never raw hex.
- CONSISTENT SPACING is a hard preference: pick ONE spacing scale and keep gaps/padding uniform (the Controls modal uses gap 24 between sections, 13 within grids, 10 for label+control). Never mix arbitrary gaps.
- Imports at top of file only. Comments explain WHY not HOW. No module-global mutable state.
- IDs (if any) follow Stripe style: prefix_<id>.
- TypeScript strict. Code must pass: bun run typecheck, bunx biome check . (2-space indent, double quotes, organized imports).
- DARK MODE: if anything scrolls, the scrollbar must be hidden/dark (see .modal-scroll). Check it.
`

// ─── the tiles (Controls is done, Dog Cam is intentionally skipped) ─────────────
// Each entry points the agent at the exact files that reveal the tile's real data
// shape + available HA entities, so concepts stay grounded.
const TILES = [
  {
    key: 'Clock',
    label: 'Clock',
    files: [
      'apps/web/src/components/tiles/ClockGreeting.tsx',
      'apps/web/src/components/tiles/ClockGreetingView.tsx',
      'apps/web/src/components/tiles/ClockSecondsRing.tsx',
      'apps/web/src/components/tiles/ClockGreetingView.stories.tsx',
    ],
    data: 'Local time + greeting + a seconds ring. NO backend. Real ambient data you COULD pull in: sun position / sunrise-sunset (HA sun.sun or weather service), day progress, upcoming calendar (events router), world clocks (pure tz math). Confirm what the events/weather routers actually expose before promising calendar/sun data.',
  },
  {
    key: 'Weather',
    label: 'Weather',
    files: [
      'apps/web/src/components/tiles/WeatherNow.tsx',
      'apps/web/src/components/tiles/WeatherNowView.tsx',
      'apps/web/src/components/tiles/WeatherNowView.stories.tsx',
      'apps/api/src/trpc/routers/weather.ts',
      'apps/api/src/services/weather-service.ts',
    ],
    data: 'Current conditions. READ weather-service.ts + weather.ts to see the EXACT fields the API returns (temp, condition, hi/lo, humidity, wind, precip, etc.) and whether hourly/daily/radar/UV/AQI are available. weather-service has sanctioned DEMO_ data until a real integration lands — design around the field SHAPE that exists.',
  },
  {
    key: 'Network',
    label: 'Network',
    files: [
      'apps/web/src/components/tiles/NetworkTile.tsx',
      'apps/web/src/components/tiles/NetworkTileView.tsx',
      'apps/web/src/components/tiles/NetworkTileView.stories.tsx',
      'apps/api/src/trpc/routers/network.ts',
      'apps/api/src/services/network-service.ts',
      'apps/api/src/integrations/unifi/index.ts',
    ],
    data: 'Wifi/network status. READ network-service.ts + the UniFi integration to see real fields (ssid, clients, up/down throughput, device list, WAN status). network-service holds sanctioned DEMO_ data — design around its field shape.',
  },
  {
    key: 'Tesla',
    label: 'Tesla',
    files: [
      'apps/web/src/components/tiles/TeslaTile.tsx',
      'apps/web/src/components/tiles/TeslaTileView.tsx',
      'apps/web/src/components/tiles/TeslaMap.tsx',
      'apps/web/src/components/tiles/TeslaTileView.stories.tsx',
      'apps/api/src/trpc/routers/tesla.ts',
      'apps/api/src/services/tesla-service.ts',
    ],
    data: 'The reference for ambition: the tile already shows a live map. Real HA entities: device_tracker.evee_location, sensor.evee_battery_level, evee_battery_range, evee_charge_rate, evee_charging, evee_inside_temperature, evee_odometer. A detail modal could be a bigger map + charge curve + trip/range ring + climate preconditioning + odometer/efficiency. READ tesla-service.ts for the exact returned shape.',
  },
  {
    key: 'Next12Hours',
    label: 'Next 12 Hours',
    files: [
      'apps/web/src/components/tiles/Next12Hours.tsx',
      'apps/web/src/components/tiles/Next12HoursView.tsx',
      'apps/web/src/components/tiles/Next12HoursView.stories.tsx',
      'apps/api/src/trpc/routers/weather.ts',
      'apps/api/src/services/weather-service.ts',
    ],
    data: 'Hourly forecast strip. READ the weather router/service for the hourly array shape (time, temp, condition, precip%). A detail modal could be a 24-48h temp/precip graph, hour-by-hour cards, "best window" picks. Only use fields that exist.',
  },
  {
    key: 'Climate',
    label: 'Climate',
    files: [
      'apps/web/src/components/tiles/ClimateTile.tsx',
      'apps/web/src/components/tiles/ClimateTileView.tsx',
      'apps/web/src/components/tiles/ClimateTileView.stories.tsx',
      'apps/api/src/trpc/routers/climate.ts',
      'apps/api/src/services/climate-service.ts',
    ],
    data: 'Thermostat. Real HA entities: climate.ac/bedroom/home/living_room, hvac modes, fan modes, set_temperature/set_hvac_mode/set_fan_mode, heat_cool low/high (dual slider exists in tokens.css). A detail modal could be multi-zone control, a schedule/timeline, temp history, eco presets. READ climate-service.ts for the real per-zone shape + available actions.',
  },
  {
    key: 'Events',
    label: 'Events',
    files: [
      'apps/web/src/components/tiles/EventsTile.tsx',
      'apps/web/src/components/tiles/EventsTileView.tsx',
      'apps/web/src/components/tiles/EventsTileView.stories.tsx',
      'apps/api/src/trpc/routers/events.ts',
      'apps/api/src/services/events-service.ts',
    ],
    data: 'Upcoming events/calendar. READ events-service.ts + events.ts for the exact event shape (title, time, source, all-day?). A detail modal could be an agenda list, a day/week timeline, countdown to next, grouping by day. Only use fields that exist.',
  },
]

// ─── schemas ────────────────────────────────────────────────────────────────────

const IDEATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tile', 'realData', 'ideas'],
  properties: {
    tile: { type: 'string' },
    realData: {
      type: 'array',
      description: 'Data points CONFIRMED available (from reading the routers/services/HA entities).',
      items: { type: 'string' },
    },
    ideas: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'name', 'concept', 'dataUsed', 'whyAmbitious', 'layout'],
        properties: {
          slug: { type: 'string', description: 'kebab-case, unique within the tile, e.g. "charge-curve"' },
          name: { type: 'string', description: 'short display name, e.g. "Charge Curve"' },
          concept: { type: 'string', description: '1-2 sentences: what the modal shows + how it expands on the tile' },
          dataUsed: { type: 'array', items: { type: 'string' } },
          whyAmbitious: { type: 'string', description: 'what makes it a richer experience than the tile, not just bigger' },
          layout: { type: 'string', description: 'rough layout + the modal panel size this concept wants (width x maxHeight, e.g. "980x760")' },
        },
      },
    },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tile', 'slug', 'componentFile', 'storyFile', 'summary', 'panelWidth', 'gatesPass'],
  properties: {
    tile: { type: 'string' },
    slug: { type: 'string' },
    componentFile: { type: 'string' },
    storyFile: { type: 'string' },
    summary: { type: 'string', description: 'what was built + any data caveats' },
    panelWidth: { type: 'number', description: 'the Modal width this POC renders at' },
    gatesPass: { type: 'boolean', description: 'true only if typecheck + biome were actually run and pass for the new files' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tile', 'recommended', 'rationale', 'ranking'],
  properties: {
    tile: { type: 'string' },
    recommended: { type: 'string', description: 'slug of the favorite' },
    rationale: { type: 'string', description: 'why it wins on ambition + ease-of-use + real-data fit + spacing' },
    runnerUp: { type: 'string' },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'score', 'note'],
        properties: {
          slug: { type: 'string' },
          score: { type: 'number', description: '0-10 overall' },
          note: { type: 'string' },
        },
      },
    },
  },
}

// ─── prompts ────────────────────────────────────────────────────────────────────

function ideatePrompt(t) {
  return `${REPO}

YOUR TASK: brainstorm 3-4 AMBITIOUS detail-modal concepts for the "${t.label}" tile.

The modal opens when the tile is tapped. It should expose the SAME domain as the tile but far richer — think "the Tesla tile's mini map, but a full detailed map + charge curve + trip view". Be ambitious but GROUNDED: every concept must run on data that actually exists.

Tile-specific context: ${t.data}

STEP 1 — Read these files to learn the REAL data shape (do not skip):
${t.files.map((f) => `  - ${f}`).join('\n')}
Also skim the relevant Home Assistant integration if data origin is unclear (apps/api/src/integrations/).

STEP 2 — Return 3-4 distinct concepts. Make them genuinely different from each other (different primary visualization / interaction), not the same idea reskinned. Each must fit a 640px-wide scrollable modal body and reuse the design tokens + ui/ primitives. Prefer concepts that add a NEW capability (control, history, projection, richer viz), not just a magnified tile.

Return ONLY the structured object.`
}

function buildPrompt(t, idea, realData) {
  const Pascal = t.key
  const VariantPascal = idea.slug
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  const comp = `${Pascal}Modal${VariantPascal}`
  const componentFile = `apps/web/src/components/tiles/modals/${comp}.tsx`
  const storyFile = `apps/web/src/components/tiles/modals/${comp}.stories.tsx`
  return `${REPO}

YOUR TASK: build a Storybook PROOF-OF-CONCEPT of ONE detail-modal concept for the "${t.label}" tile.

CONCEPT "${idea.name}" (slug: ${idea.slug}):
${idea.concept}
Data it uses: ${idea.dataUsed.join(', ')}
Why ambitious: ${idea.whyAmbitious}
Layout: ${idea.layout}

Confirmed real data for this tile: ${realData.join(', ')}

Reference the gold-standard modal before writing: apps/web/src/components/tiles/ExpandedControlsModalView.tsx and its .stories.tsx. Match that structure EXACTLY:
- A PURE view component — all data + callbacks via props, NO trpc/hooks. Render its content inside the shared <Modal> (import from "../ui"), title="${t.label}".
- Reuse ui/ primitives + tokens.css classes/vars. Uniform spacing scale (sections gap 24, inner grids gap 13, label+control gap 10 — match the Controls modal rhythm).
- SIZE THE MODAL TO THE CONCEPT: pass width/maxHeight to <Modal> (defaults 640/720, clamped to 1280x960). A wide map/graph concept can be 980+; a list can stay ~560. Report the width you chose as panelWidth. Vertical scroll is fine.

WRITE EXACTLY TWO FILES (create the modals/ dir if needed):
1. ${componentFile}
   - Export a pure view component named ${comp} with a clear Props interface (open, onClose, plus the data this concept needs). Top-of-file block comment explaining WHY this layout.
2. ${storyFile}
   - title: "Modals/${t.label}", component: ${comp}, tags: ["autodocs"].
   - At least 2 stories: a primary "${idea.name}" state and one meaningful secondary state (e.g. loading/empty/alternate data). Use realistic inline fixtures (NO FALLBACK/PLACEHOLDER/DEMO_ identifiers) and fn() for callbacks. Render-only is fine (no play function needed for the POC) — keep it lightweight.

Do NOT touch any shared file (tile-registry, Board, ui/index, Modal, other tiles). Only create your two new files.

STEP — VERIFY before returning (required): run
  bunx biome check --write apps/web/src/components/tiles/modals/${comp}.tsx apps/web/src/components/tiles/modals/${comp}.stories.tsx
  bun run typecheck
Fix anything they flag. Set gatesPass true ONLY if typecheck passes clean. Return ONLY the structured object with the real file paths.`
}

function judgePrompt(t, realData, variants) {
  const built = variants.filter(Boolean)
  return `${REPO}

YOUR TASK: judge the Storybook POC variants of the "${t.label}" detail modal and recommend ONE favorite.

Confirmed real data: ${realData.join(', ')}

Variants built (read each component + story file before scoring):
${built.map((v) => `  - slug "${v.slug}" (panel ${v.panelWidth}px): ${v.summary}\n      component: ${v.componentFile}\n      story: ${v.storyFile}`).join('\n')}

Score each 0-10 weighing: AMBITION (richer than the tile, a real expanded experience), EASE OF USE (tap targets, legibility, obvious affordances on a wall panel viewed from across a room), REAL-DATA FIT (every element backed by data that exists — penalize anything that would need invented data), SPACING/CONSISTENCY (uniform scale, reuses primitives + tokens, no arbitrary gaps), and CODE QUALITY (pure view, matches the Controls modal pattern).

Recommend the single best slug. Return ONLY the structured object.`
}

// ─── run ────────────────────────────────────────────────────────────────────────

log(`Designing detail modals for ${TILES.length} tiles: ${TILES.map((t) => t.label).join(', ')}`)

const results = await pipeline(
  TILES,
  // Stage 1 — Ideate (creative; inherits main-loop model)
  (t) => agent(ideatePrompt(t), { label: `ideate:${t.key}`, phase: 'Ideate', schema: IDEATE_SCHEMA }),
  // Stage 2 — Build every concept for this tile, in parallel
  (ideation, t) =>
    parallel(
      ideation.ideas.map((idea) => () =>
        agent(buildPrompt(t, idea, ideation.realData), {
          label: `build:${t.key}/${idea.slug}`,
          phase: 'Build POCs',
          model: 'sonnet',
          schema: BUILD_SCHEMA,
        }),
      ),
    ).then((variants) => ({ tile: t, ideation, variants: variants.filter(Boolean) })),
  // Stage 3 — Judge this tile's variants + recommend a favorite
  async (bundle) => {
    if (!bundle || bundle.variants.length === 0) return bundle
    const verdict = await agent(judgePrompt(bundle.tile, bundle.ideation.realData, bundle.variants), {
      label: `judge:${bundle.tile.key}`,
      phase: 'Judge',
      model: 'sonnet',
      schema: JUDGE_SCHEMA,
    })
    return { ...bundle, verdict }
  },
)

// ─── summary the main loop reads to pick + implement winners ─────────────────────
const summary = results.filter(Boolean).map((r) => ({
  tile: r.tile.label,
  realData: r.ideation.realData,
  recommended: r.verdict?.recommended ?? null,
  rationale: r.verdict?.rationale ?? null,
  variants: r.variants.map((v) => ({
    slug: v.slug,
    componentFile: v.componentFile,
    storyFile: v.storyFile,
    summary: v.summary,
    panelWidth: v.panelWidth,
    gatesPass: v.gatesPass,
    score: r.verdict?.ranking?.find((x) => x.slug === v.slug)?.score ?? null,
  })),
}))

log('Done. Per-tile recommendations:')
for (const s of summary) {
  log(`  ${s.tile}: → ${s.recommended ?? '(none)'}  [${s.variants.length} variants]`)
}

return { tiles: summary }
