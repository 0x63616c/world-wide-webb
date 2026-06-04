export const meta = {
  name: 'perf-lab',
  description:
    'Builds and benchmarks a throwaway pan-lab prototype that settles the rendering strategy for turning the dashboard into a pannable 2D canvas. ONE Vite+React app, a route per rendering arm (transform-all, transform+content-visibility, transform+windowing, native-scroll, canvas/WebGL), HYBRID tiles (synthetic cheap/medium + real MapLibre + real video), a full-matrix autopan sweep exporting results.json + the knee per arm, and a launcher+results UI Calum drives on the iPad. Beads (epic CC-5p4) is the shared mission state.',
  whenToUse:
    'After the perf-lab plan + beads epic are approved (control-center plan idempotent-snacking-clock.md, epic CC-5p4). Launch to scaffold the app, build all 5 arms in parallel, run the full stress sweep, finish the launcher, and finalize. Resume by re-launching (closed bd issues are skipped).',
  phases: [
    { title: 'Scaffold', detail: 'One app: shared tile-kit (synthetic + real map/video), perf HUD, autopan, router, deps preinstalled', model: 'sonnet' },
    { title: 'Build', detail: 'One agent per rendering arm, parallel, over disjoint route files; build + screenshot + close its bd issue', model: 'sonnet' },
    { title: 'Sweep', detail: 'Playwright full-matrix autopan across every arm -> results.json + the knee per arm', model: 'sonnet' },
    { title: 'Launcher', detail: 'Launcher home (arm cards + config sliders + iPad links) + results dashboard from results.json', model: 'sonnet' },
    { title: 'Finalize', detail: 'Build gate, recommendation back to control-center, close the epic, print the iPad URL', model: 'haiku' },
  ],
}

const CONTROL_CENTER = '/Users/calum/code/github.com/0x63616c/control-center'

// Model tiers (Calum's rule: haiku is a good validator/bookkeeper but a bad
// coder). sonnet writes ALL code (scaffold, arms, sweep, launcher); haiku only
// finalizes (gate + bd close + report). No opus scope: the plan is fully
// specified in beads epic CC-5p4, so there is nothing to re-derive.
const WORK_M = 'sonnet'
const BOOK_M = 'haiku'

// args (all optional):
//   dir     prototype project path (default sibling ../pan-lab)
//   epic    bd epic holding the mission state (default CC-5p4). Children are the
//           deterministic sub-issues <epic>.1..9 created in role order.
//   arms    subset of arm slugs to build (default all 5)
//   matrix  'full' (default) | 'focused' — sweep breadth
//   port    dev-server port for the launcher (default 4310)
const PROJECT_DIR = args?.dir || '/Users/calum/code/github.com/0x63616c/pan-lab'
const epic = args?.epic || 'CC-5p4'
const matrix = args?.matrix === 'focused' ? 'focused' : 'full'
const PORT = args?.port || 4310

// Deterministic role -> bd id map. Sub-issues are <epic>.<n> in the order they
// were created (scaffold .1, arms .2-.6, sweep .7, launcher .8, finalize .9).
const ISSUE = {
  scaffold: `${epic}.1`,
  sweep: `${epic}.7`,
  launcher: `${epic}.8`,
  finalize: `${epic}.9`,
}
const ALL_ARMS = [
  { slug: 'transform', issue: `${epic}.2`, title: 'transform-all (translate3d camera, all tiles mounted)' },
  { slug: 'transform-cv', issue: `${epic}.3`, title: 'transform + content-visibility + off-screen pause' },
  { slug: 'transform-window', issue: `${epic}.4`, title: 'transform + windowing (mount only intersecting tiles)' },
  { slug: 'native-scroll', issue: `${epic}.5`, title: 'native-scroll (overflow:auto + mouse-drag shim)' },
  { slug: 'canvas', issue: `${epic}.6`, title: 'canvas/WebGL renderer (Pixi or react-konva)' },
]
const ARMS = args?.arms?.length ? ALL_ARMS.filter((a) => args.arms.includes(a.slug)) : ALL_ARMS

// Shared rules every agent inherits. Code lives in PROJECT_DIR; beads is the
// control-center workspace, so ALL bd commands run from there.
const RULES = `
You are an autonomous engineer building a THROWAWAY performance-lab prototype.

WHERE THINGS LIVE:
- CODE lives in the prototype project: ${PROJECT_DIR} (a standalone Vite+React app; create it if missing).
- BEADS (the mission state) is the control-center workspace at ${CONTROL_CENTER}. Run EVERY \`bd\` command from ${CONTROL_CENTER} (cd there for bd, cd back to the project for code). Do NOT modify any control-center source — only bd state.

ABSOLUTE RULES:
- bun/bunx ALWAYS. NEVER npm/npx. Build/run with bun (e.g. \`bun run build\`, \`bun run --cwd ${PROJECT_DIR} dev\`).
- This is a throwaway lab: no real backend, no secrets, no fake-data guard to satisfy. Synthetic load is expected and correct here (it is NOT the control-center no-fake-data rule).
- Dark mode everywhere: set color-scheme:dark AND style ::-webkit-scrollbar on every scrollable surface.
- Imports at top of file only; comments explain WHY not HOW, one line, no emojis.
- Do NOT touch control-center git. Local commits in the prototype are optional; never git push.
- Beads: \`bd show <id>\` to read full acceptance before working; \`bd update <id> --claim\` before starting; \`bd update <id> --notes "<handoff>"\` to record what you did; \`bd close <id>\` ONLY when its acceptance (including the screenshot) is met. Do NOT use TodoWrite.

THE EXPERIMENT (why this exists):
- Goal: turn a fixed dashboard board into a PANNABLE 2D canvas (world bigger than the 1366x1000 screen, drag to float around, opens centered on the middle "clock" tile). We are benchmarking 5 rendering strategies to pick one.
- Geometry: a grid of N cols x N rows at a fixed cell pitch; world px = grid x pitch. Tiles are placed on the grid and keep fixed pixel sizes. The screen is a moving crop.
- HYBRID tiles: synthetic text + svg-chart tiles (cheap/medium, controlled by a heavy-ratio dial) PLUS real heavy tiles — a real MapLibre GL map and a real looping <video> — because only the real ones reproduce WebGL-context limits, GPU memory, and decode cost.
- URL params drive every run: grid, tiles, heavy (0..1), strategy, optimize (csv e.g. cv,pause), autopan (1 = run the scripted fling then publish results).
`

// ---- schemas -------------------------------------------------------------

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    status: { type: 'string', enum: ['closed', 'partial', 'blocked'] },
    buildPass: { type: 'boolean' },
    screenshot: { type: 'string', description: 'absolute path to the verification screenshot' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    followups: { type: 'string' },
  },
  required: ['ticket', 'status', 'buildPass', 'summary'],
}

const SWEEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    status: { type: 'string', enum: ['closed', 'partial', 'blocked'] },
    resultsPath: { type: 'string' },
    arms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          strategy: { type: 'string' },
          knee: { type: 'string', description: 'first config (grid/tiles/heavy) under 55fps, or "none in range"' },
          maxStable: { type: 'string', description: 'largest config that held >=55fps mean' },
          notes: { type: 'string' },
        },
        required: ['strategy', 'knee'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['ticket', 'status', 'resultsPath', 'arms', 'summary'],
}

// ---- scaffold (milestone-1) ---------------------------------------------

phase('Scaffold')
log(`Scaffolding the pan-lab app at ${PROJECT_DIR} (deps preinstalled so arms never touch shared files).`)
const scaffold = await agent(
  `${RULES}

SCAFFOLD THE APP (bd ${ISSUE.scaffold}). Claim it first. Build a SINGLE Vite + React + TypeScript app at ${PROJECT_DIR}:
1. \`bun create vite\` (react-ts) at ${PROJECT_DIR} if absent; then PREINSTALL all deps the arms need so parallel arm agents never edit package.json: react-router-dom, maplibre-gl, pixi.js, @pixi/react (or react-konva — your choice for the canvas arm), and as devDeps playwright + @playwright/test (\`bunx playwright install chromium\`).
2. Shared world geometry helper: grid(cols,rows) -> cell pitch -> world px; a makeTiles(grid, count, heavyRatio) that returns tiles {id, col, row, w, h, kind} placing them across the world, kind in {text, chart, map, video} with heavyRatio controlling the map/video fraction. The middle tile is the "clock".
3. Tile-kit components (memoized): TextTile, ChartTile (animated SVG), MapTile (real MapLibre GL, a keyless style e.g. demotiles or a raster OSM source), VideoTile (real <video> looping a small LOCAL clip — generate a ~5s test loop with ffmpeg if available, else bundle a tiny public-domain mp4; no network needed at runtime). A faint world-grid backdrop drawn as a CSS repeating-linear-gradient (never per-cell divs).
4. PerfHUD overlay: a rAF sampler computing live FPS, frame-time p95/p99, dropped-frame count, JS heap (performance.memory when present), mounted-tile count; publish a live object to window.__perf and offer CSV/JSON export.
5. Autopan driver: on ?autopan=1, run a deterministic fling/drag path over the camera for a fixed duration, record the metrics, then set window.__perfResult = {strategy, grid, tiles, heavy, fpsMean, fps1pctLow, p95, p99, dropped, heap, mounted}. Manual drag works when autopan is off.
6. URL params: grid, tiles, heavy, strategy, optimize, autopan — parsed into the run config.
7. Router: \`/\` launcher SHELL (placeholder cards for all 5 arms — the launcher agent finishes it later) and \`/arm/:strategy\` that renders the matching arm. Create EMPTY arm component files src/arms/{transform,transform-cv,transform-window,native-scroll,canvas}.tsx each exporting a stub component, and a route registry that lazy-imports all 5 — so each arm agent edits ONLY its own file and never a shared one.
8. Dark mode + styled scrollbars.
Verify: \`bun run build\` passes; start the dev server, open \`/\` and \`/arm/transform\` with the local agent-browser at 1366x1000, screenshot to ${PROJECT_DIR}/docs/screenshots/scaffold.png and inspect it. Record a handoff in the bd notes (the geometry helper API, the tile-kit props, the window.__perf/__perfResult shape, how to add an arm) and \`bd close ${ISSUE.scaffold}\`. Return the structured result.`,
  { label: `scaffold:${ISSUE.scaffold}`, phase: 'Scaffold', schema: RESULT_SCHEMA, model: WORK_M },
)
log(`scaffold: ${scaffold?.status} buildPass=${scaffold?.buildPass} — ${scaffold?.summary || ''}`)

// ---- build arms (milestone-2, parallel; sweep is the barrier after) ------

phase('Build')
log(`Building ${ARMS.length} arm(s) in parallel over disjoint route files: ${ARMS.map((a) => a.slug).join(', ')}.`)
const armResults = (
  await parallel(
    ARMS.map((a) => () =>
      agent(
        `${RULES}

BUILD ONE RENDERING ARM (bd ${a.issue}) — "${a.title}". Claim it first. Read its acceptance with \`bd show ${a.issue}\`. Implement ONLY src/arms/${a.slug}.tsx against the shared tile-kit + geometry + PerfHUD the scaffold created (read scaffold's bd notes on ${ISSUE.scaffold} for the API). Do NOT edit shared files, the router, or other arms' files — your file is lazy-imported already.

Strategy specifics:
- transform: one world div panned via imperative translate3d (camera x/y in a ref, written in the pointermove/rAF handler — NEVER setState per frame; tiles already React.memo'd). Mouse-drag + touch. Open centered on the clock tile.
- transform-cv: same as transform PLUS contain:strict + content-visibility:auto per tile and an IntersectionObserver that pauses off-screen heavy tiles (freeze video, stop map/animation). Honour ?optimize=cv,pause toggles.
- transform-window: same as transform PLUS 2D windowing — only tiles whose world-rect intersects viewport+overscan are mounted (others absent from the DOM); HUD mounted-count must reflect it.
- native-scroll: world inside an overflow:auto viewport; native momentum on touch; a pointer drag-to-scroll shim for desktop mouse; scrollbars hidden; open scrolled to center the clock.
- canvas: draw the synthetic tiles to a single canvas/stage (Pixi or react-konva) with a camera transform; overlay the real heavy tiles (map/video) as DOM at their world positions.

Verify your arm: \`bun run build\` passes; pan works (desktop drag + touch); \`/arm/${a.slug}?autopan=1\` publishes window.__perfResult. Screenshot \`/arm/${a.slug}\` headless at 1366x1000 with agent-browser to ${PROJECT_DIR}/docs/screenshots/arm-${a.slug}.png and inspect it (tiles render, no crash). Record a bd note and \`bd close ${a.issue}\`. Return the structured result (screenshot = the png path).`,
        { label: `arm:${a.slug}`, phase: 'Build', schema: RESULT_SCHEMA, model: WORK_M },
      ),
    ),
  )
).filter(Boolean)
for (const r of armResults) log(`arm ${r.ticket}: ${r.status} buildPass=${r.buildPass}`)

// ---- sweep (milestone-3) -------------------------------------------------

phase('Sweep')
const sweepRanges =
  matrix === 'full'
    ? 'grid in {12x6, 24x24, 48x48, 96x96, 200x200}, tiles in {9,25,50,100,250,500}, heavy in {0,0.1,0.2,0.5}, optimize on AND off'
    : 'grid in {24x24, 48x48}, tiles in {25,50,100}, heavy in {0,0.2}'
log(`Running the ${matrix} autopan sweep: ${sweepRanges}.`)
const sweep = await agent(
  `${RULES}

RUN THE PERFORMANCE SWEEP (bd ${ISSUE.sweep}). Claim it first. Write a Playwright script (headless chromium; add webkit if it runs cleanly) that, for EVERY arm and EVERY matrix config, loads http://localhost:${PORT}/arm/<strategy>?grid=<g>&tiles=<t>&heavy=<h>&autopan=1 (start the dev server first: \`bun run --cwd ${PROJECT_DIR} dev --port ${PORT}\` in the background, poll until 200), waits for window.__perfResult, and records: fpsMean, fps1pctLow, p95, p99, dropped, heap, mounted (+ WebGL-context/layer count if obtainable).
Matrix (${matrix}): ${sweepRanges}.
Write all rows to ${PROJECT_DIR}/results.json (array of {strategy, grid, tiles, heavy, optimize, ...metrics}). Compute the KNEE per arm = the first config whose fpsMean < 55, and the largest config that held >=55. Print a desktop baseline table. Add a short note that these are DESKTOP numbers — the iPad is the real benchmark (Calum tests feel manually via the launcher). Kill the dev server when done (target the explicit pid, never a broad pattern). \`bd close ${ISSUE.sweep}\`. Return the structured sweep result.`,
  { label: `sweep:${ISSUE.sweep}`, phase: 'Sweep', schema: SWEEP_SCHEMA, model: WORK_M },
)
log(`sweep: ${sweep?.status} — ${sweep?.summary || ''}`)
for (const a of sweep?.arms || []) log(`  ${a.strategy}: knee=${a.knee}${a.maxStable ? ` maxStable=${a.maxStable}` : ''}`)

// ---- launcher / review harness (milestone-4) -----------------------------

phase('Launcher')
log('Finishing the launcher home + results dashboard (the UI Calum drives on the iPad).')
const launcher = await agent(
  `${RULES}

FINISH THE LAUNCHER + RESULTS DASHBOARD (bd ${ISSUE.launcher}). Claim it first. Complete the \`/\` route into the review harness:
- A card per arm (${ARMS.map((a) => a.slug).join(', ')}): title, a small thumbnail/preview, a Launch button (-> /arm/<slug> with the current config), and preset chips (e.g. "48x48 / 100 tiles / 20% heavy").
- A global config bar with sliders/inputs for grid, tile-count, and heavy-ratio that flow into every Launch link as URL params, plus an "open on iPad" link form (http://homelab:${PORT}/arm/<slug>?...).
- A Results tab reading ${PROJECT_DIR}/results.json: a sortable table (arm x config -> metrics) and FPS-vs-tile-count charts per arm (simple SVG or a light chart lib), with the knee highlighted.
- Dark mode; style ::-webkit-scrollbar on every scrollable area.
Verify: \`bun run build\` passes; screenshot \`/\` (and the Results tab) headless at 1366x1000 to ${PROJECT_DIR}/docs/screenshots/launcher.png and inspect (all 5 arms listed, sliders present, results render, scrollbars dark). \`bd close ${ISSUE.launcher}\`. Return the structured result.`,
  { label: `launcher:${ISSUE.launcher}`, phase: 'Launcher', schema: RESULT_SCHEMA, model: WORK_M },
)
log(`launcher: ${launcher?.status} buildPass=${launcher?.buildPass} — ${launcher?.summary || ''}`)

// ---- finalize (haiku bookkeeping) ----------------------------------------

phase('Finalize')
const kneeLines = (sweep?.arms || []).map((a) => `${a.strategy}: knee=${a.knee}`).join('; ')
const fin = await agent(
  `${RULES}

FINALIZE (bookkeeping; no design decisions, no code beyond the recommendation note). Claim bd ${ISSUE.finalize}.
1. From ${PROJECT_DIR} run \`bun run build\` and report pass/fail verbatim.
2. \`bd epic status ${epic}\` — report what remains open; close the epic if every child is closed (\`bd close ${epic}\`).
3. Write a ONE-PARAGRAPH recommendation (which arm + which optimizations to take into control-center) into ${CONTROL_CENTER}/docs/perf-lab-recommendation.md, citing the sweep knees: ${kneeLines || '(see results.json)'}.
4. Print the iPad launch instructions: \`bun run --cwd ${PROJECT_DIR} dev --port ${PORT}\`, then \`cmux open http://localhost:${PORT}\`, and the Tailscale URL http://homelab:${PORT} for the iPad.
Do NOT git push. Return the structured result (summary = remaining-open list + build result + where the recommendation was written).`,
  { label: `finalize:${ISSUE.finalize}`, phase: 'Finalize', schema: RESULT_SCHEMA, model: BOOK_M },
)
log(`finalize: ${fin?.status} — ${fin?.summary || ''}`)

return {
  epic,
  projectDir: PROJECT_DIR,
  port: PORT,
  matrix,
  scaffold,
  arms: armResults,
  sweep,
  launcher,
  finalize: fin,
  ipadUrl: `http://homelab:${PORT}`,
}
