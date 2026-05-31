export const meta = {
  name: 'ship-p0p1',
  description:
    'Reusable parallel "drain the queue" workflow for control-center with TRUE git isolation + automatic merge-conflict resolution. Scaffolding lands on main first (barrier). Then, stage by stage: every ticket is BUILT in its own git worktree (sonnet, TDD) and committed to a per-ticket branch; fresh haiku judges adversarially REVIEW each branch diff (correctness + acceptance lenses); a SEQUENTIAL merge agent merges each branch back into main IN DEP ORDER, resolving any conflict by reading both sides + bd show, then applies that ticket\'s blocking review fixes, runs gates, and bd-closes it. Features merge before Stories spawn so story worktrees branch from a main that already has the feature changes. Ends with browser + storybook QA and a finalize (no git push unless args.push).',
  whenToUse:
    'When Calum wants a batch of independent bd tickets implemented at once, fast, fully isolated, with reviews and automatic conflict resolution. Edit SCAFFOLD/STAGES (or pass via args) to match the live queue.',
  phases: [
    { title: 'Scaffold', detail: 'Barrier on main: shared foundation (e.g. storybook) committed so every worktree inherits it', model: 'sonnet' },
    { title: 'Build', detail: 'Per stage, parallel: each ticket built TDD in its OWN git worktree, committed to a per-ticket branch', model: 'sonnet' },
    { title: 'Review', detail: 'Per stage, parallel: fresh haiku judges adversarially review each branch diff (correctness + acceptance)', model: 'haiku' },
    { title: 'Merge', detail: 'Per stage, sequential on main: merge each branch in dep order, RESOLVE CONFLICTS, apply review fixes, gates, bd close', model: 'sonnet' },
    { title: 'QA', detail: 'Adversarial: storybook build + live board at 1366x1024 (no fake data, P0 fixes visible)', model: 'haiku' },
    { title: 'Finalize', detail: 'Full gates, epic close, report; git push only if args.push', model: 'sonnet' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'
const BRPREFIX = 'ship-p0p1'

// Model tiers (Calum's rule: haiku is a good validator but a bad coder).
const WORK_M = 'sonnet' // ALL code-writing + merge/conflict resolution.
const VAL_M = 'haiku' // adversarial review + QA.

// Ticket plan — defaults reflect the live queue; override via args.
//   scaffold : ids built serially on main FIRST (shared foundation: deps, config).
//   stages   : [{ name, tickets:[] }] run in order; within a stage tickets build in
//              parallel worktrees, then merge sequentially before the next stage.
const SCAFFOLD = args?.scaffold || ['www-0bw']
const STAGES = args?.stages || [
  { name: 'Features', kind: 'standalone fix/feature', tickets: ['www-amj', 'www-ats', 'www-902', 'www-qn7'] },
  { name: 'Stories', kind: 'tile storybook stories', tickets: ['www-vut', 'www-e6x', 'www-vkk', 'www-qqk', 'www-1xb', 'www-5xj', 'www-30b', 'www-m7y', 'www-1zp'] },
]
const EPIC = args?.epic || 'www-x1o'
const MAX_REVIEW_FIXES = args?.maxReviewFixes ?? 1 // merge agent applies blocking findings; this caps re-review depth if you extend it
const ui = args?.ui !== false
const doPush = args?.push === true

// Storybook must be dark EVERYWHERE — not just the canvas. Shared spec injected
// into the scaffold build prompt and the cmux E2E validator so they agree.
const STORYBOOK_DARK = `
STORYBOOK DARK-MODE CONTRACT (full chrome, every page, scrollbars — not just the story canvas):
- Manager UI dark: \`.storybook/manager.ts\` sets a custom dark theme via \`themes.create({ base: 'dark', ... })\` matching tokens.css (app background, accent green). The sidebar, toolbar, search, and addons panel must all be dark.
- Preview/canvas dark by DEFAULT: parameters.backgrounds default to the board's dark bg (or use a global decorator wrapping every story in the dark board surface). No white flash between stories.
- Docs/autodocs dark: docs pages use the same dark theme (docs.theme), so MDX/autodocs pages are dark too.
- Native scrollbars dark on EVERY page: in both \`.storybook/manager-head.html\` and \`.storybook/preview-head.html\` add \`<style>:root,html,body{color-scheme:dark}</style>\` plus webkit scrollbar CSS (\`::-webkit-scrollbar{...}\`, thumb/track in token colors) so the manager scrollbar, the addons-panel scrollbar, and the canvas scrollbar are all dark — no white scrollbars anywhere.
- Verify by eye AND by computed style: document.documentElement colorScheme === 'dark', and body/canvas background is the dark token, on the manager frame AND inside the story iframe.
`

const RULES = `
You are an autonomous engineer on the control-center smart-home wall-panel repo at ${REPO} (branch main).

ABSOLUTE RULES:
- bun/bunx ALWAYS. NEVER npm/npx.
- TDD: write or extend the vitest test FIRST (red), then implement to green. Web tests sit in apps/web/src/**/__tests__/*.test.tsx; api tests in apps/api/src/__tests__/*.test.ts.
- Test runner is vitest via \`bun run test\`. NEVER run bare \`bun test\` — Bun's native runner is incompatible with vi.mock and reports false failures.
- ZERO fake/hardcoded/placeholder data anywhere (web + api). On unavailable data a tile renders a shimmer Skeleton and keeps retrying — never an invented number. A repo-wide grep for FALLBACK / PLACEHOLDER (uppercase identifiers) must stay empty. DEMO_ is allowed ONLY in apps/api/src/services/network-service.ts and weather-service.ts.
- Code style: imports at top of file only (never inside functions); no module-global mutable vars; comments explain WHY not HOW, one line, no emojis.
- Board is a FIXED 1366x1024 wall panel. Never design fluid/responsive.
- Shared UI primitives live under apps/web/src/components/ui/ (TileHeader, StatCell, Pill, Skeleton, TileWrapper; barrel index.ts) — PREFER them over re-inlining. Tokens in apps/web/src/styles/tokens.css; shimmer keyframes in apps/web/src/styles/globals.css.
- Beads is the shared mission state. \`bd show <id>\` to read full description/acceptance/notes before working.
`

// ---- schemas -------------------------------------------------------------

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    branch: { type: 'string', description: 'the per-ticket branch the work was committed to' },
    committed: { type: 'boolean', description: 'true if a commit was made on the branch' },
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    localGatesPass: { type: 'boolean', description: 'typecheck + the ticket-scoped tests pass in the worktree' },
    summary: { type: 'string' },
    followups: { type: 'string' },
  },
  required: ['ticket', 'branch', 'committed', 'status', 'filesChanged', 'localGatesPass', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          description: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'description'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['pass', 'findings', 'summary'],
}

const MERGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    merged: { type: 'boolean' },
    hadConflicts: { type: 'boolean' },
    conflictFiles: { type: 'array', items: { type: 'string' } },
    reviewFixesApplied: { type: 'array', items: { type: 'string' } },
    gatesPass: { type: 'boolean' },
    closed: { type: 'boolean' },
    commit: { type: 'string' },
    summary: { type: 'string' },
    followups: { type: 'string' },
  },
  required: ['ticket', 'merged', 'hadConflicts', 'gatesPass', 'closed', 'summary'],
}

const QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['pass', 'findings', 'summary'],
}

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gatesPass: { type: 'boolean' },
    epicClosed: { type: 'boolean' },
    pushed: { type: 'boolean' },
    openUnderEpic: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['gatesPass', 'pushed', 'summary'],
}

// ---- helpers -------------------------------------------------------------

// Build ONE ticket inside its own isolated git worktree, committed to a branch.
function buildTicket(id, kind, stageName) {
  const branch = `${BRPREFIX}/${id}`
  return agent(
    `${RULES}\n\nDELIVER TICKET ${id} (${kind}) IN FULL GIT ISOLATION.\nYou are running in your OWN fresh git worktree — your edits cannot affect other agents. First create your branch off the current HEAD: \`git switch -C ${branch}\`.\nThen: \`bd show ${id}\` for full acceptance criteria and \`bd update ${id} --claim\`. Work TDD — write/extend the vitest test first (red), implement to green. Run \`bun run typecheck\` and the ticket-scoped tests (\`bun run test <your test file>\`) until green. Stay strictly within this ticket's files; PREFER shared ui/ primitives.\nWhen done, COMMIT to your branch: \`git add -A && git commit -m "<focused conventional commit referencing ${id}, e.g. feat(${id}): ...>"\`. Record a handoff via \`bd update ${id} --notes\`. Do NOT bd-close (the Merge phase closes after merging). Do NOT push.\nReturn the structured handoff: branch="${branch}", committed=true only if you actually committed, filesChanged=exact paths.`,
    { label: `build:${id}`, phase: 'Build', schema: BUILD_SCHEMA, model: WORK_M, isolation: 'worktree' },
  )
}

// Review ONE ticket's branch diff. Read-only — no worktree needed, just diff refs.
async function reviewTicket(id, stageName) {
  const branch = `${BRPREFIX}/${id}`
  const lenses = [
    ['correctness', 'correctness bugs, missed edge cases, fake/hardcoded data, broken board layout at 1366x1024, and tests that merely confirm the implementation rather than the intended behavior'],
    ['acceptance', `whether every acceptance point of ${id} (\`bd show ${id}\`) has concrete evidence (a test, a code path) in the diff — anything unevidenced is a finding`],
  ]
  const reports = (
    await parallel(
      lenses.map(([lens, focus]) => () =>
        agent(
          `${RULES}\n\nADVERSARIAL REVIEW of ticket ${id} (${lens} lens, no ticket of your own). You did NOT write this code — be adversarial, find what is broken, do not confirm it works.\nThe work is committed on branch ${branch}. Read ONLY this ticket's diff: \`git diff main...${branch}\` and \`git log main..${branch}\` (read-only; do not edit or check out). Review for ${focus}.\nReturn pass=true only if there are no blocker/major findings for this lens. Each issue is a finding with severity + a concrete suggestedFix.`,
          { label: `review:${id}:${lens}`, phase: 'Review', schema: REVIEW_SCHEMA, model: VAL_M },
        ),
      ),
    )
  ).filter(Boolean)
  const findings = reports.flatMap((r) => r.findings || [])
  const blocking = findings.filter((f) => f.severity !== 'minor')
  return { id, branch, pass: reports.every((r) => r.pass) && blocking.length === 0, findings, blocking }
}

// Merge ONE ticket's branch into main (sequential; single git actor). Resolves
// conflicts AND applies that ticket's blocking review findings, then closes it.
function mergeTicket(id, blocking) {
  const branch = `${BRPREFIX}/${id}`
  const fixList = blocking.length
    ? blocking.map((f, i) => `${i + 1}. [${f.severity}] ${f.description}${f.suggestedFix ? ` — suggested: ${f.suggestedFix}` : ''}`).join('\n')
    : '(none — reviewers passed this ticket)'
  return agent(
    `${RULES}\n\nMERGE TICKET ${id} INTO main (you are the ONLY git actor right now — work in the main checkout at ${REPO}, no worktree).\n1. Ensure you are on main with a clean tree (\`git status\`). Merge the ticket branch: \`git merge --no-ff ${branch} -m "merge(${id}): <short>"\`.\n2. IF THERE ARE CONFLICTS: do NOT abort. Resolve every conflict by UNDERSTANDING BOTH SIDES — read \`bd show ${id}\` for intent, inspect the conflicted hunks, keep the change that satisfies BOTH the ticket's acceptance and the already-merged work on main (usually a union, not a pick). Remove all conflict markers, \`git add\` the resolved files, and \`git commit\` to complete the merge.\n3. APPLY these blocking review findings for ${id} before finishing (extend/repair the vitest test red->green for each, then fix):\n${fixList}\n4. Run \`bun run typecheck\` && \`bunx biome check --write .\` && the ticket-scoped tests; they must pass. Commit any review-fix changes (\`fix(${id}): address review\`).\n5. \`bd update ${id} --notes "<merge + fixes>"\` then \`bd close ${id}\`. Do NOT push.\nReturn MERGE_SCHEMA: merged, hadConflicts, conflictFiles, reviewFixesApplied, gatesPass (typecheck+biome+scoped tests), closed, commit (final sha), summary, followups.`,
    { label: `merge:${id}`, phase: 'Merge', schema: MERGE_SCHEMA, model: WORK_M },
  )
}

// ---- Scaffold (barrier on main): foundation every worktree must inherit ------

phase('Scaffold')
const scaffoldOut = []
for (const id of SCAFFOLD) {
  log(`Scaffold ${id} on main (barrier) — all later worktrees branch from this.`)
  scaffoldOut.push(
    await agent(
      `${RULES}\n${id === 'www-0bw' || /storybook|scaffold/i.test(JSON.stringify(SCAFFOLD)) ? STORYBOOK_DARK : ''}\n\nDELIVER FOUNDATION TICKET ${id} DIRECTLY ON main (no worktree — this is the shared base every later worktree inherits, so it must be committed to main first).\n\`bd show ${id}\` for acceptance, \`bd update ${id} --claim\`. Implement it (TDD where it makes sense). If this is the Storybook setup, you MUST satisfy the STORYBOOK DARK-MODE CONTRACT above in full (manager theme, dark default canvas, dark docs, dark native scrollbars on every page via color-scheme + webkit CSS) — partial dark (canvas only) FAILS. Run \`bun run typecheck\` && \`bunx biome check --write .\` && \`bun run test\` green, then \`git add -A && git commit -m "<conventional, referencing ${id}>"\`. \`bd close ${id}\`. Do NOT push.\nReturn the structured handoff (branch="main", committed=true).`,
      { label: `scaffold:${id}`, phase: 'Scaffold', schema: BUILD_SCHEMA, model: WORK_M },
    ),
  )
}

// ---- Per stage: Build (parallel worktrees) -> Review -> Merge (sequential) ---

const stageOutcomes = []
for (const stage of STAGES) {
  // BUILD: every ticket in its own isolated worktree, in parallel.
  phase('Build')
  log(`Stage "${stage.name}": building ${stage.tickets.length} tickets in parallel isolated worktrees.`)
  const builds = await parallel(stage.tickets.map((id) => () => buildTicket(id, stage.kind, stage.name)))
  const built = stage.tickets.map((id, i) => ({ id, build: builds[i] }))
  for (const b of built) {
    if (!b.build || !b.build.committed) log(`WARN ${b.id}: build did not commit (${b.build?.status || 'no result'}) — merge will skip if no branch.`)
  }

  // REVIEW: fresh adversarial judges per ticket branch, in parallel (read-only).
  phase('Review')
  const reviews = await parallel(
    built.filter((b) => b.build?.committed).map((b) => () => reviewTicket(b.id, stage.name)),
  )
  const reviewById = Object.fromEntries(reviews.filter(Boolean).map((r) => [r.id, r]))
  for (const id of Object.keys(reviewById)) {
    const r = reviewById[id]
    log(`review ${id}: pass=${r.pass}, ${r.findings.length} findings (${r.blocking.length} blocking)`)
  }

  // MERGE: sequential in dep order — resolve conflicts + apply review fixes + close.
  phase('Merge')
  const merges = []
  for (const id of stage.tickets) {
    const b = built.find((x) => x.id === id)
    if (!b?.build?.committed) {
      log(`SKIP merge ${id}: nothing committed on its branch.`)
      merges.push({ ticket: id, merged: false, hadConflicts: false, gatesPass: false, closed: false, summary: 'no commit to merge' })
      continue
    }
    const blocking = reviewById[id]?.blocking || []
    const m = await mergeTicket(id, blocking)
    merges.push(m || { ticket: id, merged: false, hadConflicts: false, gatesPass: false, closed: false, summary: 'merge agent returned null' })
    log(`merge ${id}: merged=${m?.merged} conflicts=${m?.hadConflicts} gates=${m?.gatesPass} closed=${m?.closed}`)
  }

  // Stage gate: full test suite once on the integrated main after this stage.
  const stageGate = await agent(
    `${RULES}\n\nSTAGE GATE after merging "${stage.name}" into main. From ${REPO} run the FULL suite and get it green: \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` && \`grep -rnE "FALLBACK|PLACEHOLDER" apps/ --include=*.ts --include=*.tsx\` (must be empty; DEMO_ only in network-service.ts/weather-service.ts). Fix any cross-ticket integration failure IN PLACE on main and commit (\`fix: stage integration\`). Do NOT push. Return BUILD_SCHEMA: localGatesPass=true only if all green and grep empty.`,
    { label: `stage-gate:${stage.name}`, phase: 'Merge', schema: BUILD_SCHEMA, model: WORK_M },
  )
  log(`stage "${stage.name}" gate: pass=${stageGate?.localGatesPass} — ${stageGate?.summary || ''}`)
  stageOutcomes.push({ stage: stage.name, merges, gate: stageGate?.localGatesPass })
}

// ---- QA (adversarial, fresh): storybook build + live board ------------------

phase('QA')
// cmux browser is a Playwright-style automation surface driven over a unix socket
// (`cmux browser open|goto|viewport|screenshot|get styles|eval|console|errors`).
// These validators drive the REAL running UI end-to-end. If the cmux socket is
// unavailable (no app/workspace), fall back to the local `agent-browser` binary so
// QA still runs — but PREFER cmux per Calum.
const CMUX_HOWTO = `
DRIVE THE BROWSER WITH cmux (preferred). Useful commands (run \`cmux browser --help\` first):
- \`cmux browser open <url>\` (opens a browser surface; note the surface ref it prints, e.g. surface:1)
- \`cmux browser <surface> viewport 1366 1024\`
- \`cmux browser <surface> goto <url> --snapshot-after\` / \`reload\`
- \`cmux browser <surface> screenshot --out <abs path>\`
- \`cmux browser <surface> eval "<js>"\` (returns the JS result as JSON — use to read computed styles)
- \`cmux browser <surface> get styles --selector <css> --property background-color\`
- \`cmux browser <surface> console list\` and \`cmux browser <surface> errors list\` (must be empty)
If \`cmux browser open\` errors (socket/auth/no workspace), FALL BACK to \`agent-browser\` (\`agent-browser --help\`, \`agent-browser screenshot --help\`) for screenshots and note in summary that cmux was unavailable.
Screenshots go under ${REPO}/docs/screenshots/ (create it; NEVER /tmp).`
const qaTasks = [
  () =>
    agent(
      `${RULES}\n${STORYBOOK_DARK}\n${CMUX_HOWTO}\n\nSTORYBOOK E2E + DARK-MODE QA (no ticket — you did not build this; be adversarial).\n1. Start Storybook on a fixed port: \`cd ${REPO} && (bun run --cwd apps/web storybook --ci -p 6010 >/tmp/cc-sb.log 2>&1 &)\` (use the repo's storybook script if named differently). Poll http://localhost:6010/index.json until it returns JSON (~60s; storybook is slow to boot).\n2. Open Storybook in cmux at viewport 1366x1024. Read the story list from http://localhost:6010/index.json (\`cmux browser <s> eval "await (await fetch('/index.json')).json()"\` or curl it). There must be a story for EVERY tile view (ClockGreeting, Climate, Controls, DogCam, Events, Network, Next12Hours, Tesla, WeatherNow).\n3. DARK EVERYWHERE — verify, do not assume. On the MANAGER frame eval \`getComputedStyle(document.documentElement).colorScheme\` (must be 'dark') and the manager/sidebar background (must be a dark token, not white). Then VISIT EVERY story (navigate \`/?path=/story/<id>\`), screenshot it, and for each eval the story iframe's body background + colorScheme to confirm dark (no white flash, no white canvas). Confirm scrollbars are dark (color-scheme:dark applied on manager AND preview; spot-check a story long enough to scroll). Check \`errors list\`/\`console list\` is clean.\n4. Confirm \`bun run test\` exercises the stories (addon-vitest / portable stories) — grep the config/test output.\n5. Save a contact sheet of key screenshots to ${REPO}/docs/screenshots/ship-p0p1-storybook-*.png. Kill storybook (\`pkill -f "storybook"\`).\nReturn pass=true ONLY if every tile view has a story AND the manager, every story canvas, docs, and scrollbars are all dark (computed-style verified) AND no console errors. Any white page/chrome/scrollbar is a finding. Do NOT commit.`,
      { label: 'qa:storybook-e2e', phase: 'QA', schema: QA_SCHEMA, model: VAL_M },
    ),
]
if (ui) {
  qaTasks.push(() =>
    agent(
      `${RULES}\n${CMUX_HOWTO}\n\nBOARD E2E QA (no ticket). Exercise the real rendered board as a black box at 1366x1024.\n1. Start the web dev server: \`cd ${REPO} && (bun run --cwd apps/web dev --port 4200 >/tmp/cc-web.log 2>&1 &)\`, poll http://localhost:4200 until 200 (~30s). The API may be down — EXPECTED; tiles must shimmer, never invent numbers.\n2. Open it in cmux at viewport 1366x1024, screenshot the full board to ${REPO}/docs/screenshots/ship-p0p1-board.png, and read it back.\n3. Verify: every tile renders (no crash/blank), loading tiles shimmer, the network tile reads "world-wide-webb" not HOMENET, the clock shows the seconds indicator sweeping the tile edge, ZERO fake numbers. Confirm the browser tab title is "Control Center" (\`cmux browser <s> get title\` or eval document.title). Check \`errors list\` is clean.\n4. Kill the server (\`pkill -f "apps/web dev"\`).\nReturn pass=true only if the board renders correctly with shimmer-not-fake and the P0 fixes (world-wide-webb label, Control Center title, clock seconds ring) are all visible; list gaps as findings. Do NOT commit.`,
      { label: 'qa:board-e2e', phase: 'QA', schema: QA_SCHEMA, model: VAL_M },
    ),
  )
}
const qa = (await parallel(qaTasks)).filter(Boolean)
const qaFindings = qa.flatMap((r) => r.findings || [])
log(`QA: ${qa.map((r) => (r.pass ? 'pass' : 'FAIL')).join(', ')} — ${qaFindings.length} findings`)

// ---- Finalize (sonnet; conservative git policy) -----------------------------

phase('Finalize')
const fin = await agent(
  `${RULES}\n\nFINALIZE. From ${REPO}:\n1. Final gates: \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` — all must pass; fix trivially if not and commit.\n2. \`bd epic status ${EPIC}\` — if all children are closed, \`bd close ${EPIC}\`. Report any still-open issue under the epic.\n3. Clean up merged ticket branches: \`git branch --list "${BRPREFIX}/*"\` then delete the merged ones (\`git branch -d\`).\n4. ${doPush ? 'PUSH: \`git pull --rebase && git push\`; \`git status\` must show up to date with origin.' : 'Do NOT push (conservative). Report the commits made and \`git status\` so Calum can push.'}\nReturn FINAL_SCHEMA: gatesPass, epicClosed, pushed, openUnderEpic, summary (commits + what remains).`,
  { label: 'finalize', phase: 'Finalize', schema: FINAL_SCHEMA, model: WORK_M },
)
log(`finalize: gates=${fin?.gatesPass} epicClosed=${fin?.epicClosed} pushed=${fin?.pushed} — ${fin?.summary || ''}`)

return {
  scaffold: scaffoldOut.map((s) => ({ ticket: s?.ticket, committed: s?.committed })),
  stages: stageOutcomes,
  qa: { findings: qaFindings, reports: qa.map((r) => ({ pass: r.pass, summary: r.summary })) },
  finalize: fin,
  pushed: fin?.pushed === true,
  allClean: stageOutcomes.every((s) => s.gate && s.merges.every((m) => m.merged && m.closed)) && (fin?.gatesPass === true),
}
