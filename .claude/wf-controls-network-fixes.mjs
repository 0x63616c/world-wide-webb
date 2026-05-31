export const meta = {
  name: 'controls-network-fixes',
  description: 'Port evee controls logic faithfully (fix optimistic revert + On/Off display + grid spacing), match Network tile to design, set world-wide-webb branding',
  phases: [
    { title: 'Controls', detail: 'Port evee backend+frontend controls (desired-window/polling), fix revert, On/Off only, grid spacing', model: 'sonnet' },
    { title: 'Network', detail: 'Match NetworkTile to the design, remove the weird Online text', model: 'sonnet' },
    { title: 'Branding', detail: 'world-wide-webb app title / wordmark', model: 'sonnet' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'
const EVEE = '/Users/calum/code/github.com/0x63616c/evee'

const RULES = `
You are an autonomous engineer on the control-center smart-home wall-panel at ${REPO} (branch main).
RULES:
- bun/bunx ALWAYS, never npm/npx.
- TDD: write/extend the vitest test first, then implement. Gates (ALL must pass before you finish): \`bun run typecheck\` && \`bunx biome check .\` (use \`bunx biome check --write .\` to fix) && \`bun run test\`. NEVER bare \`bun test\` (Bun's native runner is incompatible with vi.mock and reports false failures).
- ZERO fake/placeholder data except the two already-sanctioned backend demo files (apps/api/src/services/network-service.ts, apps/api/src/services/weather-service.ts). A blocking pre-commit hook (scripts/check-fake-data.sh) rejects FALLBACK/PLACEHOLDER and new DEMO_ elsewhere — do not trip it.
- Code style: imports at top only; no module-global mutable state; comments explain WHY not HOW; no emojis.
- Track in beads: \`bd create\` a ticket for your work, claim it, \`bd close\` when done. Commit to main with a focused conventional-commit message; finish with a CLEAN working tree (git status clean).
- The reference implementation that "works perfectly" is evee at ${EVEE}. Study it directly before changing anything.
`

const RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    gatesPass: { type: 'boolean' },
    summary: { type: 'string' },
    eveeFilesStudied: { type: 'array', items: { type: 'string' } },
    followups: { type: 'string' },
  },
  required: ['status', 'gatesPass', 'summary'],
}
const M = 'sonnet'

phase('Controls')
const controls = await agent(
  `${RULES}\n\nTASK — Port evee's controls (lights/lamps/fan) logic FAITHFULLY. Calum's words: "we had that perfect in evee, it had a backend part and a frontend part with polling and timers and it worked so good." control-center's current version has TWO defects:\n\n1. BUG: toggling lamps/lights OFF flips the button, then it REVERTS to on a moment later. Root cause: the frontend optimistic flip is followed by an invalidate/refetch that reads live HA (which lags), and for devices NOT pre-registered in the device_state table there is NO desired-window overlay to hold the value — so it snaps back. evee does not have this problem.\n2. DISPLAY: the Lamps cell shows a count + warmth ("6 ON · NEUTRAL"). Calum wants ONLY "On"/"Off" — if any lamp is on show "On", else "Off". No count, no warmth.\n\nDO THIS:\n- FIRST study evee's full controls stack and report which files you read (eveeFilesStudied): backend services + tRPC controls routers (look under ${EVEE}/apps/api/src/services and ${EVEE}/apps/api/src/trpc/routers/controls) AND the frontend controls tile + its polling/optimistic hooks under ${EVEE}/apps/web/src. Understand the desired-window timing, the polling cadence, and how the optimistic state is held so it NEVER reverts.\n- Replicate that pattern in control-center so toggling holds the desired value for the window and reconciles cleanly REGARDLESS of whether the entity is pre-registered in device_state (the lamps are configured in apps/api/src/config/lights.ts but are not seeded into device_state — evee's approach must still hold their optimistic state; e.g. write/auto-register the desired-window overlay on toggle, or hold desired keyed by entity, exactly as evee does).\n- Change the Lamps display to On/Off only (update the LampState/sub or the tile, drop the count + warmth, keep lamps.on = anyLampOn). Keep the existing Scene label and the fan (fan = climate fan_mode, already correct — do not regress it).\n- The fan already works via climate.set_fan_mode; verify you don't break it.\n- TDD throughout; update existing controls tests (apps/api/src/__tests__/controls.test.ts, apps/web/src/components/tiles/__tests__/ControlsTile.test.tsx) to assert the no-revert hold and the On/Off display.\nRun gates, commit, close your bd ticket. Return structured result.`,
  { label: 'controls:evee-port', phase: 'Controls', schema: RESULT, model: M },
)
log(`controls: ${controls?.status} — ${controls?.summary || ''}`)

phase('Network')
const network = await agent(
  `${RULES}\n\nTASK — Make NetworkTile match the design. Calum: "network does not look like the designs... u keep adding 'Online' which is weird."\n- Open the design: /private/tmp/design-bundle/evee/project/Evee Dashboard.html and evee-tiles.jsx (the WiFi/Network cell, sometimes called EWifi/EWifiMirror). Match its layout EXACTLY (header, the down/up figures, the butterfly traffic chart, SSID/ping footer).\n- REMOVE the standalone "Online" status word that control-center invented — the design does not show a big "Online" label; status is conveyed by the live status dot. Keep the pulsing StatusDot.\n- Data already comes from the backend (DEMO_NETWORK until UniFi); the tile must render whatever the API returns and shimmer only during genuine initial load. Do NOT add fake data in the tile.\n- Compare against evee's network/wifi tile under ${EVEE}/apps/web/src if one exists.\nTDD (update apps/web/src/components/tiles/__tests__/NetworkTile.test.tsx), run gates, commit, close your bd ticket. Return structured result.`,
  { label: 'network:design', phase: 'Network', schema: RESULT, model: M },
)
log(`network: ${network?.status} — ${network?.summary || ''}`)

phase('Branding')
const branding = await agent(
  `${RULES}\n\nTASK — Branding: Calum asked "shouldn't it say world-wide-webb". worldwidewebb.co is his domain. Find where the app's name/title is set and make it "world-wide-webb":\n- apps/web/index.html <title> (likely currently generic/Vite default), and any PWA manifest name/short_name (apple-mobile-web-app-title, manifest.json/webmanifest if present).\n- If the design or board has a visible brand/wordmark slot, use "world-wide-webb" there too; otherwise the document/PWA title is the change.\nKeep it minimal and correct. Run gates, commit, close a bd ticket. Return structured result; summary must state EXACTLY which files/strings you changed so Calum can confirm it landed where he meant.`,
  { label: 'branding:wwww', phase: 'Branding', schema: RESULT, model: M },
)
log(`branding: ${branding?.status} — ${branding?.summary || ''}`)

return { controls, network, branding }
