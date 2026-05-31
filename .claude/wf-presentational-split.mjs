export const meta = {
  name: 'presentational-split',
  description: 'Split every tile into a pure presentational *View (props = data+state+callbacks, no data deps) + thin container, with unit tests for the view covering all states and callbacks',
  phases: [
    { title: 'Split', detail: 'Per-tile: extract pure View + container, unit-test the View across all states/callbacks', model: 'sonnet' },
    { title: 'Finalize', detail: 'Close epic, consistency check, gates, Linear push', model: 'sonnet' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'
const EVEE = '/Users/calum/code/github.com/0x63616c/evee'

const RULES = `
You are an autonomous engineer on the control-center wall-panel at ${REPO} (branch main).
RULES:
- bun/bunx ALWAYS, never npm/npx.
- TDD: write the view's vitest tests first, then refactor. Gates (ALL must pass before you close): \`bun run typecheck\` && \`bunx biome check .\` (\`--write\` to fix) && \`bun run test\`. NEVER bare \`bun test\` (incompatible with vi.mock).
- ZERO fake/placeholder data except the two sanctioned backend files (network-service.ts, weather-service.ts). A blocking pre-commit hook rejects FALLBACK/PLACEHOLDER + stray DEMO_ — don't trip it.
- Code style: imports at top only; no module-global mutable state; comments explain WHY not HOW; no emojis.
- Beads: claim the ticket(s) with \`bd update <id> --claim\`, \`bd close <id>\` when done. Commit to main, focused conventional-commit message, finish with a CLEAN working tree.

REFERENCE PATTERN (evee already does this split): study ${EVEE}/apps/web/src/components/tiles/lights/lights-tile.tsx (container) and lights-tile-view.tsx (pure view), and fan/fan-tile{,-view}.tsx. Replicate that shape.

THE SPLIT (apply to the assigned tile):
- Create <Tile>View as a PURE presentational component: ALL inputs are props — the data, the state (loading/error/populated booleans or a discriminated status), and every callback (onToggle/onSetTarget/onSetMode/etc.). NO trpc, NO useQuery/useMutation, NO data-fetching hooks inside the view. Local presentation-only state (ResizeObserver width, slider-drag value) MAY live in the view since it's not a data dependency.
- Keep <Tile> as a thin container: it calls trpc, owns the query/mutation/cooldown/optimistic logic, derives the view's props, and renders <Tile>View. Behavior must NOT change.
- Unit-test the VIEW directly (no trpc mocking needed): assert it renders the loading/skeleton state, the error/empty state, the populated state, and that each callback fires with the correct args on the right interaction.
- Move/repoint existing tests as needed; keep total coverage at least as strong.
`

const RESULT = {
  type: 'object', additionalProperties: false,
  properties: {
    tickets: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    gatesPass: { type: 'boolean' },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    followups: { type: 'string' },
  },
  required: ['tickets', 'status', 'gatesPass', 'summary'],
}
const M = 'sonnet'

// tile component, its split ticket, and any extra tickets to fold into the same pass.
const TILES = [
  { name: 'ClockGreeting', ticket: 'CC-ieo', extra: '' },
  { name: 'WeatherNow', ticket: 'CC-3cg', extra: '' },
  { name: 'Next12Hours', ticket: 'CC-fi3', extra: 'Keep the chart rendering correct (the CHART_INITIAL_WIDTH fix); the ResizeObserver may stay in the view as presentation state.' },
  { name: 'NetworkTile', ticket: 'CC-9hi', extra: 'Preserve the design-matched layout (no "Online" word, StatusDot only).' },
  { name: 'TeslaTile', ticket: 'CC-4xy', extra: 'Keep the simplified "Tesla" header + lock pill.' },
  { name: 'ControlsTile', ticket: 'CC-y12', extra: 'CRITICAL: keep the cooldown poll-pause + optimistic toggle logic in the CONTAINER. ControlsGridView/ETap become pure (data + onToggle props). Do not regress the no-revert behavior or the Lamps On/Off display.' },
  { name: 'DogCamTile', ticket: 'CC-vbx', extra: '' },
  { name: 'EventsTile', ticket: 'CC-9aa', extra: 'ALSO implement CC-8hq in this pass and close it: the nearest (first/soonest) upcoming event renders its day-count in accent green. Tests for the view should assert this.' },
  { name: 'ClimateTile', ticket: 'CC-70w', extra: 'ALSO implement CC-6k8 and CC-2kd in this pass and close them. CC-6k8: setpoint->mode threshold heat when target >= 76 (cool <= 70, auto between). CC-2kd: optimistic setpoint/mode with a cooldown poll-pause (~5s) so the poll does not snap-back the value mid-interaction — reuse the SAME cooldown approach ControlsTile uses; frontend-only optimistic is sufficient. The container owns the cooldown/optimistic state; the view is pure (target, ambient, mode, action, onSetTarget, onSetMode props).' },
]

phase('Split')
const results = []
for (const t of TILES) {
  const folded =
    t.name === 'EventsTile' ? ' Tickets: CC-9aa + CC-8hq.' :
    t.name === 'ClimateTile' ? ' Tickets: CC-70w + CC-6k8 + CC-2kd.' :
    ` Ticket: ${t.ticket}.`
  const r = await agent(
    `${RULES}\n\nTILE: ${t.name}. Split apps/web/src/components/tiles/${t.name}.tsx into ${t.name}View (pure) + ${t.name} (container) per the pattern above.${folded}\n${t.extra}\nClaim the ticket(s), do the work TDD, run gates, commit, close the ticket(s). Return structured result (tickets = all closed).`,
    { label: `split:${t.name}`, phase: 'Split', schema: RESULT, model: M },
  )
  log(`${t.name}: ${r?.status} — ${r?.summary || ''}`)
  results.push(r)
}

phase('Finalize')
const fin = await agent(
  `${RULES}\n\nFINALIZE. From ${REPO}:\n1. Confirm every tile now has a pure <Tile>View + thin container, consistent across tiles. Note any tile still mixing data-fetching into its view as a followup.\n2. Run full gates: \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` — all clean.\n3. Verify these tickets are closed (close any that are genuinely done but left open): the 9 split tickets (CC-ieo, CC-3cg, CC-fi3, CC-9hi, CC-4xy, CC-y12, CC-vbx, CC-9aa, CC-70w) plus CC-8hq, CC-6k8, CC-2kd. Then close the epic CC-o36 if all its children are closed.\n4. \`bd linear sync --push\` (push-only).\nReturn structured result: status=done only if gates pass and the epic is closeable; summary = final tile structure + gate results; followups = anything left.`,
  { label: 'finalize', phase: 'Finalize', schema: RESULT, model: M },
)
log(`finalize: ${fin?.status} — ${fin?.summary || ''}`)

return { tiles: results, finalize: fin }
