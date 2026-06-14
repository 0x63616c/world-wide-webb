export const meta = {
  name: 'polish-controls-dogcam',
  description: 'Fix ControlsTile bottom-padding (match design) and DogCam broken-image glyph, then verify in-browser at 1366x1024',
  phases: [
    { title: 'Fix', detail: 'www-lqz controls padding + www-gli dogcam broken image', model: 'sonnet' },
    { title: 'Verify', detail: 'Gates + 1366x1024 screenshot', model: 'sonnet' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'
const RULES = `
You are an autonomous engineer on the control-center wall-panel at ${REPO} (branch main).
- bun/bunx ALWAYS. TDD. Gates (all): \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` (NEVER bare \`bun test\`).
- Zero fake/placeholder data except sanctioned network-service.ts. Don't trip the no-fake-data pre-commit hook.
- Imports at top; no module-global mutable state; comments explain WHY; no emojis.
- Beads: \`bd update <id> --claim\`, \`bd close <id>\`. Commit to main, focused conventional commit, clean tree.
- Tiles are already split into pure <Tile>View + container , edit the View for presentation fixes.
`
const RESULT = {
  type: 'object', additionalProperties: false,
  properties: { ticket: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'blocked'] }, gatesPass: { type: 'boolean' }, summary: { type: 'string' }, followups: { type: 'string' } },
  required: ['ticket', 'status', 'gatesPass', 'summary'],
}
const M = 'sonnet'

phase('Fix')
const controls = await agent(
  `${RULES}\n\nTICKET www-lqz , ControlsTile bottom row nearly touches the card edge; bottom spacing must match the sides (design = consistent padding all around). Read \`bd show www-lqz\` (notes have the exact design spec). Design (Evee Dashboard.html ctrl tile): tile padding 20 (ours is 22), inner grid flex:1 + gridTemplateColumns '1fr 1fr' + gridTemplateRows '1fr 1fr' + gap 13. ROOT CAUSE: the flex:1 grid child has implicit min-height:auto and overflows the bottom padding. FIX in ControlsTileView: set the Tile padding to 20 and add \`minHeight: 0\` to the 2x2 grid container so it fits within the padded box (bottom == sides == 20). Add/adjust a test if feasible. Run gates, commit, close www-lqz. Return structured result.`,
  { label: 'www-lqz controls-padding', phase: 'Fix', schema: RESULT, model: M },
)
log(`www-lqz: ${controls?.status} , ${controls?.summary || ''}`)

const dogcam = await agent(
  `${RULES}\n\nTICKET www-gli , DogCam shows the browser's broken-image glyph (an <img> with no valid src; the live stream is deferred, www-2x4). Read \`bd show www-gli\`. FIX in DogCamTileView: do NOT render an <img> when there is no real snapshot/stream URL , only render the <img> when a valid snapshotUrl exists; otherwise show the design's camera-glyph placeholder in the .feed shell (no broken image). No fake stream URL. Update DogCamTileView tests to assert no <img> renders without a URL and the placeholder shows. Run gates, commit, close www-gli. Return structured result.`,
  { label: 'www-gli dogcam-image', phase: 'Fix', schema: RESULT, model: M },
)
log(`www-gli: ${dogcam?.status} , ${dogcam?.summary || ''}`)

phase('Verify')
const verify = await agent(
  `${RULES}\n\nVERIFY (no ticket). 1) Run full gates: \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` , all clean. 2) Start the web dev server in the background (\`cd ${REPO} && (bun run --cwd products/control-center/web dev --port 4200 >/tmp/cc-web.log 2>&1 &)\`), poll http://localhost:4200 until 200. 3) Use the local \`agent-browser\` binary (check \`agent-browser screenshot --help\`) headless at viewport 1366x1024; screenshot the full board to ${REPO}/docs/screenshots/board-polish.png (create dir; never /tmp). 4) Read the screenshot back and confirm: the Controls card has even padding on all four sides (bottom no longer touching), and the Dog Cam shows a clean camera placeholder (no broken-image glyph). 5) Kill the dev server; commit the screenshot. Return structured result: gatesPass + a summary describing exactly what you saw, followups for any remaining visual issue.`,
  { label: 'verify:screenshot', phase: 'Verify', schema: RESULT, model: M },
)
log(`verify: ${verify?.gatesPass} , ${verify?.summary || ''}`)

return { controls, dogcam, verify }
