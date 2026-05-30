export const meta = {
  name: 'finish-control-center',
  description: 'Finish the control-center wall-panel dashboard: clear every non-deferred CC- bd ticket via TDD subagents, refactor to shared primitives, verify in-browser at 1366x1024, gates green',
  whenToUse: 'Driving the control-center dashboard to a production finish across many beads tickets',
  phases: [
    { title: 'Plan', detail: 'Parallel read-only planning of the complex foundation tickets', model: 'sonnet' },
    { title: 'Foundations', detail: 'format hook, shared primitives, anti-flicker backend, no-fake-data policy', model: 'sonnet' },
    { title: 'Tiles', detail: 'Per-tile fidelity + remove-fake bundles, grouped by file', model: 'sonnet' },
    { title: 'Consistency', detail: 'Refactor pass: every tile on shared primitives, one scale, zero fake data', model: 'sonnet' },
    { title: 'Verify', detail: 'Full gates + live browser render at 1366x1024 + screenshots', model: 'sonnet' },
    { title: 'Finalize', detail: 'Repo-wide fake-data grep, bd ready check, Linear push, memory', model: 'sonnet' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'

// Shared rules every implementer agent must obey. Kept identical so behavior
// (TDD, gates, no-fake-data, commit hygiene) does not drift between tiles.
const RULES = `
You are an autonomous engineer on the control-center smart-home wall-panel repo at ${REPO} (branch main).

ABSOLUTE RULES:
- bun/bunx ALWAYS. NEVER npm/npx.
- TDD: extend or write the vitest test FIRST (red), then implement to green. Web tests sit in src/components/tiles/__tests__/*.test.tsx; api tests in apps/api/src/__tests__/*.test.ts.
- GATES (all must pass before you close a ticket): \`bun run typecheck\` && \`bunx biome check .\` (use \`bunx biome check --write .\` to auto-fix lint/format) && \`bun run test\`.
  CRITICAL: the test runner is vitest via \`bun run test\`. NEVER run bare \`bun test\` — Bun's native runner is incompatible with this suite's vi.mock and will report false failures.
- ZERO fake/hardcoded/placeholder data anywhere (web + api). On unavailable data a tile renders a shimmer Skeleton and keeps retrying — never an invented number. A repo-wide grep for FALLBACK / PLACEHOLDER must end empty. Do not introduce new ones.
- Code style: imports at top of file only (never inside functions); no module-global mutable vars; comments explain WHY not HOW, one line, no emojis.
- Beads tracking: \`bd update <id> --claim\` before starting each ticket, \`bd close <id>\` when its acceptance criteria are met and gates pass. Do NOT use TodoWrite. Do NOT touch deferred tickets CC-32o, CC-2x4, CC-d3t.
- Commit to main with a focused conventional-commit message (feat/fix/refactor/chore/test) scoped to the ticket(s). Keep commits small. Do NOT push (orchestrator pushes at the end).
- Run \`bd show <id>\` for each ticket to read its full description, acceptance criteria, and the exact design/evee/control-center file references — follow them precisely.

REFERENCES:
- Design (1:1 target): /private/tmp/design-bundle/evee/project/Evee Dashboard.html and /private/tmp/design-bundle/evee/project/evee-tiles.jsx
- Behavior reference (entity mapping, anti-flicker, loading states): /Users/calum/code/github.com/0x63616c/evee
- Shared primitives live under apps/web/src/components/ui/ — PREFER them over re-inlining headers/stats/pills/skeletons.
- Design tokens already in apps/web/src/styles/tokens.css; shimmer keyframes in apps/web/src/styles/globals.css.
`

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    approach: { type: 'string', description: 'Concise step-by-step implementation approach' },
    files: { type: 'array', items: { type: 'string' } },
    testCases: { type: 'array', items: { type: 'string' } },
    risks: { type: 'string' },
  },
  required: ['ticket', 'approach', 'files', 'testCases', 'risks'],
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tickets: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['closed', 'partial', 'blocked'] },
    gatesPass: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    commit: { type: 'string' },
    summary: { type: 'string' },
    followups: { type: 'string', description: 'Anything left undone or new bd issues filed' },
  },
  required: ['tickets', 'status', 'gatesPass', 'summary'],
}

const M = 'sonnet'

// ---------------------------------------------------------------- Plan phase
phase('Plan')
log('Planning the complex foundation tickets in parallel (read-only).')

const PLAN_TICKETS = [
  { id: 'CC-4wq', focus: 'shared tile primitives under components/ui/ (Tile, TileHeader, Stat, Pill, Chip, StatusDot, Skeleton) + @keyframes shimmer in globals.css. One TileHeader serves both small and large (Tesla) headers via size props.' },
  { id: 'CC-5yh', focus: 'controls anti-flicker: backend optimistic-state overlay + HA websocket reconcile, ported from evee. Read evee for the exact pattern.' },
  { id: 'CC-nra', focus: 'no-fake-data policy: API services THROW instead of returning constants; QueryClient infinite retry (~5s, no refetchOnWindowFocus); every tile renders the shared Skeleton when !data (covers first-load AND outage); delete ALL FALLBACK/PLACEHOLDER blocks api+web. Depends on CC-4wq primitives.' },
  { id: 'CC-lad', focus: 'consistency gate / refactor pass: every tile uses the shared primitives, one spacing+type scale, identical loading/error treatment, zero fake data. Identify any remaining duplication to extract.' },
]

const plans = await parallel(
  PLAN_TICKETS.map((t) => () =>
    agent(
      `${RULES}\n\nPLANNING ONLY — do not edit files, do not claim the ticket. Read \`bd show ${t.id}\`, the cited references, and the current code, then produce a tight implementation plan for ${t.id}. Focus: ${t.focus}\nReturn the plan as structured output.`,
      { label: `plan:${t.id}`, phase: 'Plan', schema: PLAN_SCHEMA, model: M },
    ),
  ),
)

for (const p of plans.filter(Boolean)) {
  log(`PLAN ${p.ticket}: ${p.approach}`)
}
const planFor = (id) => {
  const p = plans.filter(Boolean).find((x) => x.ticket === id)
  return p ? `Pre-approved plan:\n- Approach: ${p.approach}\n- Files: ${(p.files || []).join(', ')}\n- Test cases: ${(p.testCases || []).join('; ')}\n- Risks: ${p.risks}\n` : ''
}

// ---------------------------------------------------------- Foundations phase
phase('Foundations')

// CC-2ig first so every later commit is auto-formatted by the hook.
const r2ig = await agent(
  `${RULES}\n\nTICKET CC-2ig — Pre-commit hook: auto-format staged TS with biome (auto-fix, non-blocking).\nClaim it, implement per \`bd show CC-2ig\`. The hook must auto-fix staged TS/TSX with biome and re-stage, and must be NON-BLOCKING (always exit 0 so it never wedges commits). Add a test or a documented manual verification. Run gates, commit, close. Return structured result.`,
  { label: 'CC-2ig format-hook', phase: 'Foundations', schema: RESULT_SCHEMA, model: M },
)
log(`CC-2ig: ${r2ig?.status} — ${r2ig?.summary || ''}`)

const r4wq = await agent(
  `${RULES}\n\nTICKET CC-4wq — Design system: shared tile primitives.\n${planFor('CC-4wq')}\nClaim it, build the primitives under apps/web/src/components/ui/ with unit render tests for each, add the @keyframes shimmer to globals.css and a Skeleton that uses it. One TileHeader must cover both the small (WiFi/Controls) and large (Tesla) headers via size props. Do NOT yet refactor every tile to use them (that is CC-lad) — just build, export, and test the primitives, and replace TilePlaceholder's role with the new Skeleton scaffold. Run gates, commit, close. Return structured result.`,
  { label: 'CC-4wq primitives', phase: 'Foundations', schema: RESULT_SCHEMA, model: M },
)
log(`CC-4wq: ${r4wq?.status} — ${r4wq?.summary || ''}`)

const r5yh = await agent(
  `${RULES}\n\nTICKET CC-5yh — Controls anti-flicker: backend optimistic-state overlay + HA websocket reconcile (port from evee).\n${planFor('CC-5yh')}\nClaim it, implement per \`bd show CC-5yh\`, porting the pattern from the evee reference. Add api tests for the overlay/reconcile logic. Run gates, commit, close. Return structured result.`,
  { label: 'CC-5yh anti-flicker', phase: 'Foundations', schema: RESULT_SCHEMA, model: M },
)
log(`CC-5yh: ${r5yh?.status} — ${r5yh?.summary || ''}`)

const rnra = await agent(
  `${RULES}\n\nTICKET CC-nra — No fake data: first-load + outage show shimmer skeleton and retry, never invented values. This is the canonical no-fake-data pass and it BLOCKS the per-tile tickets, so it must end with ZERO FALLBACK/PLACEHOLDER constants in api OR web.\n${planFor('CC-nra')}\nClaim it. Per \`bd show CC-nra\`: (1) make each API service throw on error/unconfigured instead of returning constants; (2) configure QueryClient defaults in apps/web/src/lib/trpc.ts for infinite retry (~5s delay, refetchOnWindowFocus:false); (3) convert EVERY tile so that when there is no data it returns the shared Skeleton layout (covering first load AND error) — no \`data ?? FALLBACK\`; (4) DELETE every FALLBACK/PLACEHOLDER block in api and web. Update the existing vitest tests to assert skeleton-on-no-data and real-data render (no fake flashes). Run gates including a repo grep proving FALLBACK/PLACEHOLDER are gone in the files you changed. Commit, close. Return structured result.`,
  { label: 'CC-nra no-fake-data', phase: 'Foundations', schema: RESULT_SCHEMA, model: M },
)
log(`CC-nra: ${rnra?.status} — ${rnra?.summary || ''}`)

await agent(
  `Run \`cd ${REPO} && bd linear sync --push\` (push-only mirror to Linear; never pull). Report the output in one line.`,
  { label: 'linear-sync foundations', phase: 'Foundations', model: M },
)

// ----------------------------------------------------------------- Tiles phase
phase('Tiles')

// Grouped by file to avoid two sequential agents thrashing the same component.
const TILE_BUNDLES = [
  { label: 'Controls', ids: ['CC-bh5', 'CC-azw'], note: 'CC-bh5: remove fake FALLBACK + shimmer, relabel More->Scene, spin fan when on. CC-azw: port evee explicit lights config so lamps (Hue) vs lights (switch fixtures) map to the right entities. Both touch ControlsTile.tsx (+ controls-service for azw).' },
  { label: 'Climate', ids: ['CC-2bk'], note: 'remove fake FALLBACK + shimmer, show live HVAC action, drop the extra icon box.' },
  { label: 'Tesla', ids: ['CC-dba'], note: 'remove fake fallback, add tile chrome/padding, fix header title order. Do NOT implement the deferred map ticket CC-d3t.' },
  { label: 'Events', ids: ['CC-pnj'], note: 'remove fake placeholder events + shimmer; speed up refetch.' },
  { label: 'Network', ids: ['CC-sxs'], note: 'match design + remove fake data; honest placeholder/shimmer until the UniFi integration exists (CC-32o is deferred — do NOT build UniFi). No invented traffic/throughput numbers.' },
  { label: 'Weather', ids: ['CC-75u', 'CC-iwi'], note: 'CC-75u: real shimmer animation; show Skeleton on error instead of the dash layout. CC-iwi: swap the Sunset/Sunrise metric cell based on time of day. Both touch WeatherNow.tsx.' },
  { label: 'Next12Hours', ids: ['CC-14m', 'CC-z2x'], note: 'CC-14m: remove fake placeholder temps + shimmer; inherit global retry. CC-z2x: make the Feels line more subtle. Both touch Next12Hours.tsx.' },
  { label: 'Clock', ids: ['CC-882', 'CC-oi9'], note: 'CC-882: padding 22->28 and date font-size 17->18. CC-oi9: fix squished AM/PM letters (inherited negative tracking). Both touch ClockGreeting.tsx.' },
  { label: 'DogCam', ids: ['CC-883'], note: "add 'Dog Cam' section header and fix padding 16->20. Do NOT implement the deferred stream ticket CC-2x4." },
  { label: 'Shell', ids: ['CC-amc', 'CC-6sf'], note: 'CC-amc: apply safe-area-inset so the board clears the iPad home bar (PWA). CC-6sf: add a favicon using the evee logo.' },
]

const tileResults = []
for (const b of TILE_BUNDLES) {
  const r = await agent(
    `${RULES}\n\nTILE BUNDLE: ${b.label} — tickets ${b.ids.join(' + ')}.\n${b.note}\nThese tiles were already cleaned of fake data by CC-nra and the primitives exist (CC-4wq). For EACH ticket: claim it, read \`bd show <id>\`, verify against the design file, implement the remaining tile-specific fidelity using the shared primitives (do not re-inline headers/stats/pills/skeletons), extend the vitest tests, satisfy acceptance criteria. Run gates after the bundle, commit (one focused commit, may close multiple tickets), close each ticket. Return structured result listing all tickets handled.`,
    { label: `tiles:${b.label}`, phase: 'Tiles', schema: RESULT_SCHEMA, model: M },
  )
  log(`${b.label} (${b.ids.join('+')}): ${r?.status} — ${r?.summary || ''}`)
  tileResults.push(r)
}

await agent(
  `Run \`cd ${REPO} && bd linear sync --push\` (push-only). Report output in one line.`,
  { label: 'linear-sync tiles', phase: 'Tiles', model: M },
)

// ----------------------------------------------------------- Consistency phase
phase('Consistency')
const rlad = await agent(
  `${RULES}\n\nTICKET CC-lad — Consistency gate + refactor pass: every tile uses the shared primitives, ONE spacing/type scale, identical loading/error treatment, zero fake data.\n${planFor('CC-lad')}\nClaim it. Audit every tile in apps/web/src/components/tiles/. Refactor any tile still hand-rolling a section header, stat, pill, chip, status dot, or skeleton to use the components/ui primitives. Ensure the loading/error path is identical across tiles (shared Skeleton). Confirm one consistent padding/type scale per the design. Repo-wide grep: FALLBACK/PLACEHOLDER must be empty. If you extract additional shared structure, record it. Update tests as needed. Run gates, commit (refactor:), close. If you find a reusable insight worth persisting, run \`bd remember "<insight>"\`. Return structured result.`,
  { label: 'CC-lad consistency', phase: 'Consistency', schema: RESULT_SCHEMA, model: M },
)
log(`CC-lad: ${rlad?.status} — ${rlad?.summary || ''}`)

// --------------------------------------------------------------- Verify phase
phase('Verify')

const gates = await agent(
  `${RULES}\n\nVERIFICATION GATE (no ticket). From ${REPO} run, in order, and report each result verbatim:\n1. \`bun run typecheck\`\n2. \`bunx biome check .\`\n3. \`bun run test\`\n4. \`bun run build\` if a web build script exists (check apps/web/package.json; skip cleanly if absent)\n5. \`grep -rnE "FALLBACK|PLACEHOLDER" apps/ packages/ --include=*.ts --include=*.tsx\` — this MUST return nothing (exit 1). If any remain, FIX them (replace with shared Skeleton + retry, never fake data), re-run gates, and commit.\nReturn structured result: gatesPass true only if 1-3 are clean AND the grep is empty.`,
  { label: 'verify:gates', phase: 'Verify', schema: RESULT_SCHEMA, model: M },
)
log(`gates: pass=${gates?.gatesPass} — ${gates?.summary || ''}`)

const shots = await agent(
  `${RULES}\n\nLIVE BROWSER VERIFICATION (no ticket). The board is a fixed 1366x1024 wall panel. Verify the real rendered UI, do not trust tests alone.\nSteps:\n1. Start the web dev server in the background: \`cd ${REPO} && (bun run --cwd apps/web dev --port 4200 >/tmp/cc-web.log 2>&1 &)\` then poll http://localhost:4200 until it returns 200 (up to ~30s). The API will likely be down — that is EXPECTED and is itself the no-fake-data test: tiles must show shimmer skeletons, never invented numbers.\n2. Use the locally-installed \`agent-browser\` binary (run \`agent-browser --help\` and \`agent-browser screenshot --help\` to learn the exact flags). Open http://localhost:4200 with the viewport set to 1366x1024 (headless). Screenshot the full board to ${REPO}/docs/screenshots/board-skeleton.png (create the dir; NEVER use /tmp for screenshots).\n3. Read the screenshot back with the Read tool and inspect it against /private/tmp/design-bundle/evee/project/Evee Dashboard.html: confirm the tile grid layout matches, every tile renders (no crash/blank), loading tiles shimmer, and there are ZERO fake/hardcoded numbers visible anywhere.\n4. Kill the dev server (\`pkill -f "apps/web dev"\` or by PID). Commit the screenshot (chore: add board screenshot).\nReturn structured result: gatesPass = (board renders correctly at 1366x1024 with shimmer skeletons and no fake data); summary must describe exactly what you saw in the screenshot; followups = any visual gaps vs the design.`,
  { label: 'verify:browser', phase: 'Verify', schema: RESULT_SCHEMA, model: M },
)
log(`browser: pass=${shots?.gatesPass} — ${shots?.summary || ''}`)

// ------------------------------------------------------------- Finalize phase
phase('Finalize')
const fin = await agent(
  `${RULES}\n\nFINALIZE (no ticket). From ${REPO}:\n1. \`bd ready\` and \`bd list --status=open\` — confirm only the deferred tickets (CC-32o, CC-2x4, CC-d3t) remain and nothing non-deferred is open. If any non-deferred CC- ticket is still open, report it as a followup (do NOT close work that is not actually done).\n2. Final gates: \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` — all clean.\n3. \`bd linear sync --push\` (push-only).\n4. \`bd remember\` a one-line note capturing any durable insight from this build (e.g. the shared-primitives location or the no-fake-data pattern) if not already remembered.\nReturn structured result: status=closed only if the queue is clear of non-deferred work and gates are green; summary should state the final bd ready output and gate results; followups lists anything still open.`,
  { label: 'finalize', phase: 'Finalize', schema: RESULT_SCHEMA, model: M },
)
log(`finalize: ${fin?.status} — ${fin?.summary || ''}`)

return {
  foundations: [r2ig, r4wq, r5yh, rnra].filter(Boolean),
  tiles: tileResults.filter(Boolean),
  consistency: rlad,
  verify: { gates, browser: shots },
  finalize: fin,
}
