export const meta = {
  name: 'tesla-live-map',
  description: 'www-d3t: replace TeslaTile static SVG with a themed MapLibre + Protomaps live GPS map; build -> adversarial review -> fix',
  phases: [
    { title: 'Build', detail: 'implement live map + wire lat/lon + fix tests', model: 'sonnet' },
    { title: 'Review', detail: 'adversarial review of the diff vs spec & conventions', model: 'sonnet' },
    { title: 'Fix', detail: 'apply confirmed review findings, gates green', model: 'sonnet' },
  ],
}

// ── Shared context every agent needs ─────────────────────────────────────────
const CTX = `
PROJECT: control-center, a fixed 1366x1024 smart-home wall-panel dashboard. Monorepo: products/control-center/web (React 19 + Vite), products/control-center/api (tRPC).
You are working inside a git worktree; cwd is the repo root. Do NOT commit, push, or start a dev server , the orchestrator handles git + live verification.

GOAL (bd issue www-d3t): Replace the hand-drawn static SVG street grid in the Tesla tile with a real, themed, live GPS map.

KEY FACTS:
- Deps already installed in products/control-center/web: maplibre-gl@5.24.0, pmtiles@4.4.1, @protomaps/basemaps@5.7.2.
- A SoCal basemap is on disk at products/control-center/web/public/maps/socal.pmtiles (Protomaps planetiler "protomaps" schema, MVT, maxzoom 15). Vite serves it at the URL path /maps/socal.pmtiles (HTTP range requests). It is gitignored , never commit it.
- The tile's data source products/control-center/api already returns real lat/lon. Live API confirmed returning lat 34.0537, lon -118.2428 (home: Home, LA). Field "place" is a string like "Home".

CURRENT CODE:
- products/control-center/web/src/components/tiles/TeslaTileView.tsx , pure presentational. Contains an inline function TeslaMap() that renders the static SVG grid (the thing to replace). Populated props: { status:"populated", locked, charging, rate, pct, range, odo, climate }.
- products/control-center/web/src/components/tiles/TeslaTile.tsx , container; calls trpc.tesla.get.useQuery and maps data -> TeslaTileView props. Currently drops data.lat/lon/place.
- Tests: products/control-center/web/src/components/tiles/__tests__/TeslaTile.test.tsx and TeslaTileView.test.tsx (vitest + @testing-library/react + jsdom).

THEME TOKENS (products/control-center/web/src/styles/tokens.css) , match these EXACTLY:
- --bg #060708, --tile #0c0e11, --nest #15191e, --hair rgba(255,255,255,.06)
- --acc #5be37d (primary green), --acc-2 #37c95e, --acc-dim rgba(91,227,125,.12), --acc-line rgba(91,227,125,.4)
- --ink #eef0f2, --ink-2 #9197a1
- Map container in the old SVG used background #0A0D10, borderRadius 14, 1px solid var(--hair). Keep that frame.

REPO CONVENTIONS (hard rules):
- ZERO fake/hardcoded/placeholder data. No FALLBACK/PLACEHOLDER uppercase identifiers anywhere (a pre-commit grep blocks them). The ONLY allowed hardcoded coordinate is a home default-center [-118.2428, 34.0537] used when lat/lon are null (so the map still renders during outages). Document WHY in a comment.
- Use shared UI primitives in products/control-center/web/src/components/ui (TileHeader, Stat, Pill, Skeleton, Tile) , do not re-inline them. The map overlays (place label, status pill) should reuse existing pill/cap styling already used in the old TeslaMap.
- Imports at top of file only. Comments explain WHY not HOW. No module-global mutable vars.
- Test runner is \`bun run test\` (vitest). NEVER run bare \`bun test\`.
`

// ── Build spec ───────────────────────────────────────────────────────────────
const BUILD = `${CTX}

IMPLEMENT the live map. Concrete requirements:

1) NEW FILE products/control-center/web/src/components/tiles/TeslaMap.tsx , a self-contained MapLibre map component.
   Props: { lat: number | null; lon: number | null; place: string }.
   Behavior:
   - Register the pmtiles protocol with maplibre ONCE (module-level guard is fine, but no mutable app state):
       import maplibregl from "maplibre-gl";
       import { Protocol } from "pmtiles";
       import { layers, namedFlavor } from "@protomaps/basemaps";
     In a useEffect on mount, add the protocol (maplibregl.addProtocol("pmtiles", protocol.tile)) and create the map.
   - Source: a "protomaps" vector source of type "vector", url "pmtiles:///maps/socal.pmtiles".
   - Style: build layers with @protomaps/basemaps: layers("protomaps", namedFlavor("black"), { lang: "en" }). Use a DARK flavor ("black"). Then THEME it to match: set the map background/earth to #0A0D10, water slightly darker/blue-black, and recolor road casings/lines toward the green accent family (subtle , roads as muted dark lines with the main arterials hinted green, NOT a neon mess). Keep it tasteful and dark like the rest of the dashboard.
   - LABELS: this is a tiny tile; heavy labels are noise. Drop symbol/label layers (filter them out of the layers() result) so you do NOT need a glyphs endpoint and avoid clutter. (If you keep any labels, you MUST set style.glyphs to the public Protomaps assets URL "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf" , no API key.)
   - Camera: center on [lon ?? -118.2428, lat ?? 34.0537], zoom ~15 (street level , tune so a few blocks around the pin are visible; the container is ~300x150px). The home default-center constant is the ONLY allowed hardcoded coordinate (comment why).
   - Interactivity: this is a wall panel. Disable map interactions (dragPan, scrollZoom, doubleClickZoom, touchZoomRotate, keyboard, dragRotate) , it's a passive view, not a pannable map. attributionControl: keep a compact attribution (Protomaps/OpenStreetMap) , a small "© OpenStreetMap" is required and fine.
   - PIN: add a custom green pin marker at [lon, lat] matching the old SVG pin aesthetic (a glowing green teardrop/dot using --acc with a soft --acc-dim halo). Use a DOM element marker (new maplibregl.Marker({ element })) so it's CSS-themable. When lat/lon are null, do NOT show a pin (we don't know where the car is) , just show the default-centered map.
   - RECENTER: in a useEffect keyed on [lat, lon], when they change and are non-null, map.setCenter([lon, lat]) (or easeTo) and move the marker. The viewport follows the car.
   - OVERLAYS (absolute-positioned over the map, like the old TeslaMap): top-left a small label showing \`place\` (reuse the existing "cap" class). bottom-left a status pill (reuse className="pill on" with the green dot) , text shows \`place\` (e.g. "Home"). Do NOT hardcode "a fake street name" or "Parked · Home" anymore , those were fake; use real \`place\`.
   - Fill the parent: 100% width/height, borderRadius 14, overflow hidden, 1px solid var(--hair), background #0A0D10 (so it looks right before tiles load).
   - Cleanup: remove the map (map.remove()) on unmount; remove the protocol if you added it locally.
   - jsdom-SAFETY: this component must not be imported-and-crash under jsdom (no WebGL). The unit tests will mock "maplibre-gl"; structure the component so all maplibre calls happen inside useEffect (not at render/module top-level beyond imports), and guard against the container ref being null.

2) EDIT products/control-center/web/src/components/tiles/TeslaTileView.tsx
   - Remove the inline static SVG TeslaMap function entirely.
   - Add lat: number | null, lon: number | null, place: string to the "populated" variant of TeslaTileViewProps.
   - Render <TeslaMap lat={lat} lon={lon} place={place} /> in the map slot (the existing flex:1, minHeight:140 wrapper).

3) EDIT products/control-center/web/src/components/tiles/TeslaTile.tsx
   - Pass lat={data.lat}, lon={data.lon}, place={data.place} through to TeslaTileView.

4) TESTS , keep the suite green (\`bun run test\`):
   - MapLibre uses WebGL and CANNOT run in jsdom. In BOTH TeslaTile.test.tsx and TeslaTileView.test.tsx, add a vi.mock for "maplibre-gl" (default export with Map (addControl/on/remove/setCenter/easeTo no-ops), Marker (setLngLat/addTo/remove/getElement chainable), NavigationControl, addProtocol/removeProtocol), and mock "pmtiles" (Protocol class with a .tile method) and "@protomaps/basemaps" (layers -> [], namedFlavor -> ({})). Goal: the components render in jsdom without touching real WebGL.
   - The old TeslaTile.test.tsx asserts screen.getByText("a fake street name") and /Parked · Home/. Those labels are GONE. Replace them with assertions on the real \`place\` from MOCK_DATA ("Home") , e.g. expect the place to appear in the map overlay. Keep ALL other assertions (header, pills, charge %, stats) passing.
   - TeslaTileView.test.tsx populated props objects must now include lat/lon/place (use lat:34.0537, lon:-118.2428, place:"Home"). Keep existing assertions.
   - Add at least one new test: TeslaMap renders its place overlay and does not crash when lat/lon are null (default-center path).

5) GATES , run and get GREEN before returning:
   - bun run test
   - bun run typecheck
   - bunx biome check --write .   (auto-fix formatting/lint)
   Re-run until all pass. If a gate cannot pass, explain precisely why.

Return a concise summary: files created/modified, how you themed the basemap (key color choices), the chosen display zoom, how you made tests jsdom-safe, and the exact pass/fail output of the three gates.
`

phase('Build')
const build = await agent(BUILD, { phase: 'Build', model: 'sonnet' })

// ── Adversarial review ───────────────────────────────────────────────────────
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gatesVerified', 'findings', 'summary'],
  properties: {
    gatesVerified: {
      type: 'object',
      additionalProperties: false,
      required: ['test', 'typecheck', 'biome'],
      properties: {
        test: { type: 'string', description: 'pass | fail | not-run, with one-line evidence' },
        typecheck: { type: 'string' },
        biome: { type: 'string' },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue', 'fix', 'confident'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string', description: 'concrete change to make' },
          confident: { type: 'boolean', description: 'true only if you verified this is a real problem, not a guess' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const REVIEW = `${CTX}

A build agent just implemented the live map. Adversarially REVIEW the working-tree diff. Run:
  git -c core.pager=cat diff --stat
  git -c core.pager=cat diff
to see every change (also inspect new untracked files via git status + reading them).

INDEPENDENTLY VERIFY the three gates yourself by RUNNING them (do not trust the build report):
  bun run test ; bun run typecheck ; bunx biome check .

Review for, in priority order:
1) Correctness: does the map actually init from pmtiles:///maps/socal.pmtiles, recenter on lat/lon changes, show the pin only when coords are known, and clean up on unmount? Any obvious MapLibre misuse (e.g. setCenter [lat,lon] swapped , MapLibre wants [lon,lat])?
2) jsdom safety: are the maplibre-gl / pmtiles / @protomaps/basemaps mocks correct and complete? Will the suite truly avoid WebGL? Did they actually keep every prior assertion meaningful (not just deleted to make green)?
3) Conventions: NO fake/hardcoded data beyond the single documented home default-center. No FALLBACK/PLACEHOLDER. Shared primitives used. No leftover dead code (old SVG fully removed). No module-global mutable state. Imports at top.
4) Theme fidelity: dark + green accent matching tokens; labels not cluttering; interactions disabled (wall panel); attribution present but compact.
5) Did they accidentally stage/commit the large socal.pmtiles, or un-gitignore it? It must remain ignored.

Report findings as structured data. Mark confident=true ONLY for problems you verified by reading code or running gates. Prefer few high-signal findings over nitpicks. If the build is solid, say so with an empty/near-empty findings list.
`

phase('Review')
const review = await agent(REVIEW, { phase: 'Review', model: 'sonnet', schema: REVIEW_SCHEMA })

const actionable = (review.findings || []).filter(f => f.confident && (f.severity === 'blocker' || f.severity === 'major'))

// ── Fix (only if there are confident blocker/major findings) ─────────────────
let fix = null
if (actionable.length > 0) {
  const FIX = `${CTX}

A reviewer found these CONFIRMED blocker/major issues in the current working tree. Fix EACH one, then re-run all gates to GREEN.

FINDINGS:
${actionable.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}\n   problem: ${f.issue}\n   fix: ${f.fix}`).join('\n\n')}

After fixing:
  bun run test ; bun run typecheck ; bunx biome check --write .
All must pass. Return what you changed and the final gate output. Do NOT introduce fake data or commit anything.
`
  phase('Fix')
  fix = await agent(FIX, { phase: 'Fix', model: 'sonnet' })
}

return {
  build,
  review: { gatesVerified: review.gatesVerified, summary: review.summary, findings: review.findings },
  actionableCount: actionable.length,
  fix,
}
