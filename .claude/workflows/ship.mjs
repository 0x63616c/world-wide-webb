export const meta = {
  name: 'ship',
  description:
    'Factory-Missions-style ship workflow for control-center. Beads IS the shared mission state: scope writes a validation contract + ordered feature plan into a bd epic (child issues, deps, acceptance, milestone labels); workers build serially off the bd queue with TDD; fresh adversarial validators run per milestone (haiku gate-runner + sonnet judge + contract check + browser QA) in a fix loop; then harden and finalize. Resumable from the epic.',
  whenToUse:
    'After scoping a bd issue/epic/goal into an approved validation contract + ordered milestone/feature plan (scope inline, get Calum approval), launch this to persist the plan to beads then build → validate-per-milestone → fix → harden → finalize. Resume a crashed run with args.resume=<epicId>.',
  phases: [
    { title: 'Scope', detail: 'Only if no approved plan/resume: derive validation contract + milestones + features from the issue/goal', model: 'opus' },
    { title: 'Persist', detail: 'Write the plan into beads: epic, child feature issues, deps for order, acceptance + milestone labels', model: 'haiku' },
    { title: 'Build', detail: 'Serial TDD worker per feature (sonnet — coding), driven off the bd queue, fresh context, commit + close each', model: 'sonnet' },
    { title: 'Validate', detail: 'Per milestone, all haiku/fresh/adversarial (good validator, different model from the coder): gate-runner + scrutiny judge + contract check + browser QA', model: 'haiku' },
    { title: 'Fix', detail: 'Findings become bd bugs blocking the epic; drain them (sonnet — coding); re-validate until clean or capped (logged)', model: 'sonnet' },
    { title: 'Harden', detail: 'Durable scaffolding: memories, written rules, blocking pre-commit guards', model: 'sonnet' },
    { title: 'Finalize', detail: 'Epic/queue check, final gates, Linear push-only, report (no git push unless args.push)', model: 'haiku' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'

// Four model tiers (Factory "droid whispering"). Hard constraint from Calum:
// HAIKU IS A GOOD VALIDATOR BUT A BAD CODER — it never writes code in this
// workflow. opus reasons about scope; sonnet writes ALL code (build, fix, harden);
// haiku does everything that only reads/judges/bookkeeps — validation judging
// (a different model from the coder, so it doesn't share the coder's blind spots,
// exactly the talk's "validate with a different model" point), plus the mechanical
// bd/linear/queue/gate-running where judgment is ~zero.
const SCOPE_M = 'opus' // scope/decompose: careful reasoning
const WORK_M = 'sonnet' // ALL code-writing: build, fix, harden. NEVER haiku here.
const VAL_M = 'haiku' // validator judges: scrutiny, contract, browser. Reads/judges only.
const BOOK_M = 'haiku' // mechanical bookkeeping: persist plan, run gates, finalize.

// args (all optional):
//   issue        bd issue/epic id this run delivers (e.g. "www-xxx")
//   goal         freeform goal text if there is no issue yet
//   contract     [{ id, text }] approved behavioral assertions (the validation contract)
//   milestones   [{ name, features:[{ key, title, note, assertions:[id] }] }] approved ordered plan
//   resume       <epicId> — skip Scope+Persist, rebuild the plan from the bd epic and drain its queue
//   ui           true|false — run the live browser validator (default true; this repo is a UI board)
//   maxFixRounds integer — cap on validate->fix rounds per milestone (default 3)
//   push         true to git push at the end (default false: conservative, Finalize reports instead)
const issue = args?.issue || ''
const goal = args?.goal || ''
const ui = args?.ui !== false
const MAX_FIX_ROUNDS = args?.maxFixRounds ?? 3
const doPush = args?.push === true
const resumeEpic = args?.resume || ''

// Guard: without a target we cannot produce a validation contract. Fail early
// rather than creating a bogus epic with an empty goal (www-ddo9.4).
if (!resumeEpic && !issue && !goal) {
  throw new Error(
    'ship: no target — pass at least one of: args.issue (bd id), args.goal (freeform string), or args.resume (epic id to resume). Example: ship({ issue: "www-xxx" }) or ship({ goal: "add X feature" }).',
  )
}

// Shared rules every implementer/validator agent inherits, so behavior (bun,
// TDD, gates, no-fake-data, commit hygiene, beads) never drifts between agents.
const RULES = `
You are an autonomous engineer on the control-center smart-home wall-panel repo at ${REPO} (branch main).

ABSOLUTE RULES:
- bun/bunx ALWAYS. NEVER npm/npx.
- TDD: write or extend the vitest test FIRST (red), then implement to green. Web tests sit in apps/web/src/**/__tests__/*.test.tsx; api tests in apps/api/src/__tests__/*.test.ts.
- GATES (all must pass before you close a ticket): \`bun run typecheck\` && \`bunx biome check .\` (use \`bunx biome check --write .\` to auto-fix lint/format) && \`bun run test\`.
  CRITICAL: the test runner is vitest via \`bun run test\`. NEVER run bare \`bun test\` — Bun's native runner is incompatible with this suite's vi.mock and reports false failures.
- ZERO fake/hardcoded/placeholder data anywhere (web + api). On unavailable data a tile renders a shimmer Skeleton and keeps retrying — never an invented number. A repo-wide grep for FALLBACK / PLACEHOLDER must stay empty. Do not introduce new ones.
- Code style: imports at top of file only (never inside functions); no module-global mutable vars; comments explain WHY not HOW, one line, no emojis.
- Beads is the shared mission state. \`bd show <id>\` to read an issue's full description/acceptance/notes before working it. \`bd update <id> --claim\` before starting, \`bd update <id> --notes "<handoff>"\` to record what you did, \`bd close <id>\` when acceptance is met and gates pass. Do NOT use TodoWrite.
- Commit with the format the commit-msg guard REQUIRES: \`type(area/www-xxx): desc\` — a conventional type (feat/fix/refactor/chore/test/docs/ci/build) whose scope carries an area AND the bd ticket id, e.g. \`feat(web/tiles/www-m9k): add poller\`. A bare \`feat: ...\` is rejected. Keep commits small and focused. Do NOT push (Finalize handles push policy).
- This workflow IS the manual lifecycle parallelized; it follows docs/ticket-standards.md — the taxonomy (feature/bug/refactor/chore/spike/epic → real bd types), the Definition of Ready, and the Definition of Done (gates green + no fake data + screenshot@1366x1024 for UI + committed referencing the ticket + closed). The per-feature acceptance you are handed already encodes it.

REPO MAP:
- apps/web — React board (fixed 1366x1024 wall panel). Shared primitives live under apps/web/src/components/ui/ — PREFER them over re-inlining headers/stats/pills/skeletons. Tokens in apps/web/src/styles/tokens.css; shimmer keyframes in apps/web/src/styles/globals.css.
- apps/api — tRPC backend; services THROW on error/unconfigured rather than returning constants.
- QueryClient (apps/web/src/lib/trpc.ts) retries infinitely (~5s) with refetchOnWindowFocus:false, so tiles recover from outages without fake data.
`

// ---- schemas -------------------------------------------------------------

// Scope output: the validation contract + the ordered milestone/feature plan.
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Short mission title for the epic' },
    assertions: {
      type: 'array',
      description: 'Flat list of testable behavioral assertions defining DONE, written before any code',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
      },
    },
    milestones: {
      type: 'array',
      description: 'Ordered milestones; each a logical checkpoint. Foundations before dependents.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          features: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string', description: 'Existing bd id if known, else a short slug' },
                title: { type: 'string' },
                note: { type: 'string' },
                assertions: { type: 'array', items: { type: 'string' } },
              },
              required: ['key', 'title', 'note', 'assertions'],
            },
          },
        },
        required: ['name', 'features'],
      },
    },
    risks: { type: 'string' },
  },
  required: ['title', 'assertions', 'milestones', 'risks'],
}

// Result of persisting the plan to beads: the epic id + every feature's bd id.
const PERSIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    epic: { type: 'string', description: 'The created (or reused) epic id' },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          label: { type: 'string', description: 'milestone label applied to its issues' },
          featureIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'label', 'featureIds'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['epic', 'milestones'],
}

// Worker / fixer structured handoff.
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tickets: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['closed', 'partial', 'blocked'] },
    gatesPass: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    commit: { type: 'string' },
    assertionsCovered: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    followups: { type: 'string', description: 'Anything left undone or new bd issues filed' },
  },
  required: ['tickets', 'status', 'gatesPass', 'summary'],
}

// Raw output from the haiku gate-runner (no judgment, just verbatim results).
const GATES_RAW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    typecheck: { type: 'string', description: 'verbatim tail of bun run typecheck' },
    biome: { type: 'string', description: 'verbatim tail of bunx biome check .' },
    test: { type: 'string', description: 'verbatim tail of bun run test' },
    grep: { type: 'string', description: 'verbatim output of the FALLBACK/PLACEHOLDER grep (empty is good)' },
    exitOk: { type: 'boolean', description: 'true if all three commands exited 0 and grep was empty' },
  },
  required: ['typecheck', 'biome', 'test', 'grep', 'exitOk'],
}

// Adversarial validator verdict.
const VALIDATION_SCHEMA = {
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
          area: { type: 'string' },
          description: { type: 'string' },
          suggestedFix: { type: 'string' },
          assertion: { type: 'string', description: 'contract assertion id this violates, if any' },
        },
        required: ['severity', 'area', 'description'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['pass', 'findings', 'summary'],
}

// ---- scope (skipped on resume or when an approved plan is supplied) -------

let epic = resumeEpic
let contract = args?.contract
let milestones = args?.milestones
let missionTitle = issue || goal || 'mission'

if (resumeEpic) {
  // Resume: beads is the source of truth. Reconstruct contract + milestones
  // from the epic (contract stored in --design; milestones from labels).
  phase('Persist')
  log(`Resuming from epic ${resumeEpic} — rebuilding plan from beads.`)
  const restored = await agent(
    `${RULES}\n\nRESUME (no edits). Read the mission epic and its children from beads and reconstruct the plan.\nRun \`bd show ${resumeEpic}\` (the validation contract is stored in the epic's design field), \`bd epic status ${resumeEpic}\`, and \`bd ready --parent ${resumeEpic} --json\` plus \`bd list --json\` for the epic's children. Group the children by their milestone-* label in label order. Return: epic=${resumeEpic}, the milestones with their label and the still-open featureIds, and put the contract text in summary.`,
    { label: `resume:${resumeEpic}`, phase: 'Persist', schema: PERSIST_SCHEMA, model: BOOK_M },
  )
  epic = restored.epic
  milestones = restored.milestones.map((m) => ({
    name: m.name,
    label: m.label,
    features: (m.featureIds || []).map((id) => ({ key: id, title: id, note: '', assertions: [] })),
  }))
  log(`Resumed epic ${epic} with ${milestones.length} milestone(s).`)
} else if (!milestones || !milestones.length) {
  phase('Scope')
  const target = issue ? `bd issue/epic ${issue}` : `this goal: ${goal}`
  log(`Scoping ${target} into a validation contract + milestone plan.`)
  const scoped = await agent(
    `${RULES}\n\nSCOPE ONLY — do NOT edit files or claim/create tickets yet.\nTarget: ${target}.\n${issue ? `Read \`bd show ${issue}\` (and any sub-issues/epics it links).` : 'There is no bd issue yet; derive scope from the goal and the codebase.'}\nProduce a VALIDATION CONTRACT first: a flat list of testable behavioral assertions that define DONE, independent of implementation. Then decompose into ORDERED MILESTONES (logical checkpoints), each holding features that claim the assertion ids they satisfy. The sum of all features must cover every assertion. Order so foundations/shared work precede dependents. Return structured output only.`,
    { label: `scope:${issue || 'goal'}`, phase: 'Scope', schema: PLAN_SCHEMA, model: SCOPE_M },
  )
  contract = scoped.assertions
  milestones = scoped.milestones
  missionTitle = scoped.title
  for (const a of contract) log(`ASSERT ${a.id}: ${a.text}`)
  for (let i = 0; i < milestones.length; i++) {
    log(`MILESTONE ${i + 1} ${milestones[i].name}: ${milestones[i].features.map((f) => f.key).join(', ')}`)
  }
}

const contractText =
  (contract || []).map((a) => `- ${a.id}: ${a.text}`).join('\n') ||
  '(contract restored from epic design field; see bd show on the epic)'

// ---- persist plan to beads (haiku bookkeeping) ---------------------------

if (!resumeEpic) {
  phase('Persist')
  log('Writing the validation contract + plan into beads as the shared mission state.')
  const planJson = JSON.stringify({ title: missionTitle, assertions: contract, milestones }, null, 0)
  const persisted = await agent(
    `${RULES}\n\nPERSIST THE PLAN TO BEADS (mechanical; no design decisions — translate the approved plan into bd commands).\nApproved plan JSON:\n${planJson}\n\nDo exactly this:\n1. ${issue && issue.match(/^[A-Z]+-/) ? `Use ${issue} as the epic if it is already type=epic (\`bd show ${issue}\`), else create an epic with \`bd create --type=epic --title "${missionTitle}" --json\` and reparent ${issue} under it (\`bd update ${issue} --parent <epic>\`).` : `Create the epic: \`bd create --type=epic --title "${missionTitle}" --json\` and capture its id.`} Store the full validation contract in the epic's design field via \`bd update <epic> --design "<assertions, one per line>"\`.\n2. For each milestone (in order, index from 1) and each feature in it: if feature.key is an existing bd id (matches /^[A-Z]+-/), update it (\`bd update <id> --parent <epic> --acceptance "<its assertion texts>" --labels milestone-<n>\`); otherwise create it: \`bd create --type=feature --parent <epic> --title "<title>" --description "<note>" --acceptance "<its assertion texts>" --labels milestone-<n> --json\` and capture the new id.\n3. Encode serial order with deps so milestone N+1 features depend on milestone N features: \`bd dep add <featureInN+1> <featureInN>\` (a representative link per pair is enough to gate readiness across the boundary).\n4. \`bd dolt push\` is NOT needed; autosync handles it.\nReturn: the epic id, and for each milestone its name, label (milestone-<n>), and the list of feature bd ids.`,
    { label: 'persist:beads', phase: 'Persist', schema: PERSIST_SCHEMA, model: BOOK_M },
  )
  epic = persisted.epic
  // Merge the assigned bd ids back into the in-memory milestone plan.
  milestones = persisted.milestones.map((pm, i) => ({
    name: pm.name,
    label: pm.label,
    features: pm.featureIds.map((id, j) => ({
      ...(milestones[i]?.features?.[j] || {}),
      key: id,
    })),
  }))
  log(`Persisted to epic ${epic}.`)
}

// ---- shared validation helpers (used per milestone) ----------------------

// Haiku runner: executes gates, dumps raw output. No judgment (creator side of
// the creator/verifier split applied to bookkeeping — verbose output is cheap).
async function runGatesRaw(tag) {
  return agent(
    `${RULES}\n\nGATE RUNNER (${tag}, mechanical — DO NOT judge, just run and report verbatim). From ${REPO} run each and capture the last ~40 lines:\n1. \`bun run typecheck\`\n2. \`bunx biome check .\`\n3. \`bun run test\`\n4. \`grep -rnE "FALLBACK|PLACEHOLDER" apps/ packages/ --include=*.ts --include=*.tsx\`\nReturn the raw tails and exitOk=true only if 1-3 all exited 0 and the grep produced no matches. Do not fix anything.`,
    { label: `gates:${tag}`, phase: 'Validate', schema: GATES_RAW_SCHEMA, model: BOOK_M },
  )
}

// Adversarial validation for one milestone. Fresh agents that did not write the
// code. Scrutiny judge reads the haiku gate dump + the diff; contract + browser
// check behavior. Returns {pass, findings, blocking}.
async function validateMilestone(m, round) {
  const tag = `${m.label}-r${round}`
  // Unique port per milestone/round so concurrent dev servers never collide (OOM/port-clash fix).
  const port = 4300 + ((parseInt((m.label || "").replace(/\D/g, ""), 10) || 1) * 10) + round
  const ids = m.features.map((f) => f.key).join(', ')
  const msAssertions =
    [...new Set(m.features.flatMap((f) => f.assertions || []))].join(', ') || '(see each feature acceptance)'
  // The gate-runner agent returns null when the API connection blips (ConnectionRefused).
  // Retry a few times, then fall back to a "gates failed" sentinel — a transient API
  // hiccup must degrade to a fix-round, never crash (and lose) the whole multi-hour run.
  let raw = null
  for (let attempt = 0; attempt < 3 && !raw; attempt++) {
    raw = await runGatesRaw(tag)
    if (!raw) log(`gate-runner null for ${tag} (attempt ${attempt + 1}/3, transient API error) — retrying`)
  }
  if (!raw) {
    log(`gate-runner unavailable for ${tag} after 3 tries; marking gates failed this round (NOT crashing the run)`)
    raw = { typecheck: "(unavailable — API error)", biome: "(unavailable)", test: "(unavailable)", grep: "", exitOk: false }
  }
  const tasks = [
    () =>
      agent(
        `${RULES}\n\nSCRUTINY JUDGE (${tag}, no ticket). You did NOT write this code — be adversarial; find what is broken, do not confirm it works.\nThe gate runner already executed the gates. Raw results:\n- typecheck: ${raw.typecheck}\n- biome: ${raw.biome}\n- test: ${raw.test}\n- grep(FALLBACK/PLACEHOLDER, must be empty): ${raw.grep}\n- exitOk: ${raw.exitOk}\n\nIndependently inspect the diff for milestone "${m.name}" (issues ${ids}) via \`git log\`/\`git diff\`. Review for correctness bugs, missing edge cases, and tests that merely confirm the implementation rather than the intended behavior. Return: pass=true only if exitOk is true AND review found no blocker/major issues. Every issue is a finding with severity + suggestedFix.`,
        { label: `validate:scrutiny:${tag}`, phase: 'Validate', schema: VALIDATION_SCHEMA, model: VAL_M },
      ),
    () =>
      agent(
        `${RULES}\n\nCONTRACT JUDGE (${tag}, no ticket). Verify this milestone against the assertions it claims, NOT against the code.\nMilestone "${m.name}" claims assertions: ${msAssertions}\nFull contract for reference:\n${contractText}\nFor each claimed assertion, find concrete evidence it holds (a test, a code path, observed behavior). An assertion you cannot evidence is a finding (severity major, assertion id set). Return pass=true only if every claimed assertion is satisfied.`,
        { label: `validate:contract:${tag}`, phase: 'Validate', schema: VALIDATION_SCHEMA, model: VAL_M },
      ),
  ]
  if (ui) {
    tasks.push(() =>
      agent(
        `${RULES}\n\nUSER-TESTING JUDGE (${tag}, no ticket). Exercise the real rendered board as a black box. Board is a fixed 1366x1024 wall panel.\n1. Start the web dev server in the background: \`cd ${REPO} && (bun run --cwd apps/web dev --port ${port} >/tmp/cc-web-${tag}.log 2>&1 &)\` then poll http://localhost:${port} until 200 (up to ~30s). The API may be down — EXPECTED, and itself the no-fake-data test: tiles must shimmer, never invented numbers.\n2. Use the local \`agent-browser\` binary (check \`agent-browser --help\` and \`agent-browser screenshot --help\`). Open http://localhost:${port} headless at viewport 1366x1024 and screenshot the full board to ${REPO}/docs/screenshots/ship-${tag}.png (create the dir; NEVER /tmp).\n3. Read the screenshot back and inspect: every tile renders (no crash/blank), loading tiles shimmer, layout matches the design, ZERO fake numbers visible. Click through any flow touched by milestone "${m.name}".\n4. Tear down ONLY what you started: kill the dev server on its exact port with \`fkill :${port}\` (NEVER a loose \`pkill -f\` — this is a shared machine and that matches other sessions). Then make sure agent-browser's headless chromium has exited (it leaks ~1.5GB if left running).\nReturn pass=true only if the board renders correctly with shimmer-not-fake and the touched flows work; describe what you saw; list gaps as findings.`,
        { label: `validate:browser:${tag}`, phase: 'Validate', schema: VALIDATION_SCHEMA, model: VAL_M },
      ),
    )
  }
  const reports = (await parallel(tasks)).filter(Boolean)
  const findings = reports.flatMap((r) => r.findings || [])
  const blocking = findings.filter((f) => f.severity !== 'minor')
  return { pass: reports.every((r) => r.pass) && blocking.length === 0, findings, blocking }
}

// ---- per-milestone build -> validate -> fix ------------------------------

const milestoneOutcomes = []
for (let mi = 0; mi < milestones.length; mi++) {
  const m = milestones[mi]
  if (!m.label) m.label = `milestone-${mi + 1}`

  // BUILD: drain this milestone's queue from beads, one fresh worker per feature.
  phase('Build')
  log(`Milestone ${mi + 1}/${milestones.length} "${m.name}" — building ${m.features.length} feature(s) off the bd queue.`)
  for (const f of m.features) {
    await agent(
      `${RULES}\n\nVALIDATION CONTRACT (definition of done for the whole mission):\n${contractText}\n\nMILESTONE "${m.name}" — FEATURE ${f.key}.\n${f.title ? `Title: ${f.title}\n` : ''}${f.note ? `Notes: ${f.note}\n` : ''}Run \`bd show ${f.key}\` for full acceptance criteria. Claim it (\`bd update ${f.key} --claim\`). Work with fresh context: assume only a clean checkout at the last commit. Write tests first, implement to satisfy the acceptance criteria. SPEED: run a FAST per-feature gate ONLY — bun run typecheck, then bunx biome check --write ., then ONLY the test file(s) you created or changed (bun run test -- <your-test-path>), NOT the whole suite (the milestone validator runs the full suite once). Then commit. Record a structured handoff in the issue (\`bd update ${f.key} --notes "<what you did, commands+exit codes, anything left>"\`) and \`bd close ${f.key}\` when acceptance is met and gates pass. Return the structured handoff (assertionsCovered = the assertion ids you actually satisfied).`,
      { label: `build:${f.key}`, phase: 'Build', schema: RESULT_SCHEMA, model: WORK_M },
    )
  }

  // VALIDATE this milestone, then FIX-loop until clean or capped.
  phase('Validate')
  let v = await validateMilestone(m, 0)
  log(`validate ${m.label} r0: pass=${v.pass}, ${v.findings.length} findings (${v.blocking.length} blocking).`)

  phase('Fix')
  let round = 0
  while (!v.pass && round < MAX_FIX_ROUNDS) {
    round++
    const list = v.blocking
      .map((f, i) => `${i + 1}. [${f.severity}] (${f.area}${f.assertion ? `, assertion ${f.assertion}` : ''}) ${f.description}${f.suggestedFix ? ` — suggested: ${f.suggestedFix}` : ''}`)
      .join('\n')
    log(`Fix ${m.label} round ${round}/${MAX_FIX_ROUNDS}: ${v.blocking.length} blocking findings.`)
    await agent(
      `${RULES}\n\nFIX PASS (${m.label} round ${round}). Adversarial validators found these blocking issues in milestone "${m.name}":\n${list}\n\nVALIDATION CONTRACT:\n${contractText}\n\nFile each distinct fix as a bd bug blocking the epic: \`bd create --type=bug --parent ${epic} --title "<short>" --description "<finding>"\`, claim it, reproduce, write/extend a vitest test that fails because of it (red), fix to green, run ONLY the test you added plus bun run typecheck, commit (fix:), close the bug. Do NOT push. HARD CONSTRAINT (no rabbit-holing): edit ONLY feature source and tests. NEVER edit vitest/CI/build config, vitest.config.*, scripts/, coverage.sh, package.json, or this workflow. A slow, hanging, or OOMing test means the HOST is RAM-limited, NOT a code bug — do NOT raise heaps or tune the test harness; note it in followups and move on. Return the structured handoff; followups = anything unresolved.`,
      { label: `fix:${m.label}:r${round}`, phase: 'Fix', schema: RESULT_SCHEMA, model: WORK_M },
    )
    v = await validateMilestone(m, round)
    log(`validate ${m.label} r${round}: pass=${v.pass}, ${v.findings.length} findings (${v.blocking.length} blocking).`)
  }
  if (!v.pass) {
    // No silent caps: surface unfinished milestones loudly.
    log(`CAPPED milestone "${m.name}" at ${MAX_FIX_ROUNDS} fix rounds with ${v.blocking.length} blocking findings still open. NOT silently dropped — recorded as open bd bugs under epic ${epic}.`)
  }
  milestoneOutcomes.push({ name: m.name, label: m.label, pass: v.pass, rounds: round, findings: v.findings })
}

// ---- harden (Calum's harden-as-you-go: make invariants mechanical) -------

phase('Harden')
const harden = await agent(
  `${RULES}\n\nHARDEN / AUDIT (no pre-existing ticket — file your own bd issues under epic ${epic}, claim, close). This step WRITES code (hooks, config, rule edits) so it runs on the coding model.\nReview everything this mission changed (\`git log\`/\`git diff\` since it started) and the conventions/footguns it surfaced. Convert durable lessons into scaffolding so they cannot regress:\n1. If the mission relied on a hard rule a grep could enforce (forbidden pattern, banned import), add or extend a BLOCKING pre-commit guard (exit non-zero) under the repo's lefthook/git hooks, with a tiny proof it blocks and does not false-positive. Complement, do not replace, the existing non-blocking biome auto-format hook.\n2. Append any genuinely new, forceful one-line invariant to CLAUDE.md / AGENTS.md (do not duplicate the beads-managed block or existing rules).\n3. \`bd remember\` any durable project insight this mission produced that is not already stored.\n4. File a bd issue for anything bigger worth a follow-up.\nIf there is nothing durable to extract, say so explicitly rather than inventing scaffolding. Run gates after any change, commit (chore/ci:). Return structured result: summary = scaffolding created (or "none needed"), followups = issues filed.`,
  { label: 'harden:audit', phase: 'Harden', schema: RESULT_SCHEMA, model: WORK_M },
)
log(`harden: ${harden?.status} — ${harden?.summary || ''}`)

// ---- finalize (haiku bookkeeping; conservative git policy) ---------------

phase('Finalize')
const fin = await agent(
  `${RULES}\n\nFINALIZE (${BOOK_M} bookkeeping, no design decisions). From ${REPO}:\n1. \`bd epic status ${epic}\` and \`bd ready --parent ${epic} --json\` — report what remains open under this mission.\n2. Final gates: run \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\` and report verbatim whether all passed.\n3. \`bd linear sync --push\` (push-only mirror to Linear; never pull).\n4. ${doPush ? 'GIT PUSH: \`git pull --rebase && git push\`, then \`git status\` must show up to date with origin.' : 'Do NOT git push (conservative). Report the exact commits made and \`git status\` so Calum can push.'}\nReturn structured result: status=closed only if gates passed and (if push requested) push succeeded; summary states the epic's remaining-open list, gate results, and ${doPush ? 'push status' : 'commits awaiting push'}; followups = anything still open.`,
  { label: 'finalize', phase: 'Finalize', schema: RESULT_SCHEMA, model: BOOK_M },
)
log(`finalize: ${fin?.status} — ${fin?.summary || ''}`)

return {
  epic,
  mission: missionTitle,
  contract,
  milestones: milestoneOutcomes,
  harden,
  finalize: fin,
  pushed: doPush,
  allMilestonesPassed: milestoneOutcomes.every((m) => m.pass),
}
