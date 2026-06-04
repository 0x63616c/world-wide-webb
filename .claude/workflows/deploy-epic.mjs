export const meta = {
  name: 'deploy-epic',
  description:
    'Drive the www-5ag deploy epic to done: build the bosun deploy tool (TDD, prune unit-tested BEFORE any live swarm contact), author deploy.config.ts/Dockerfiles/CI/bootstrap/save-scripts, run gates, push->CI->GHCR, then (only when args.live=true) deploy to the homelab swarm over SSH and verify every acceptance-checklist item. Beads (www-5ag.*) is the shared state; each child ticket is one acceptance criterion whose exact test lives in docs/acceptance-checklist.md. Closes a ticket only on observed evidence; honest [-] (with reason) for true human-only gates. Capstone opens a PR (Calum merges). Resumable via resumeFromRunId.',
  whenToUse:
    'To feature-complete the bosun/Swarm deploy epic www-5ag. First invocation (no args.live) builds the whole software side, runs gates + CI, and STOPS at the human gate reporting exactly what Calum must do in a web console (GHCR pull auth; optional op service-account token). After Calum clears those, re-invoke with args.live=true + resumeFromRunId=<id> to replay the build from cache and run the live deploy + verification.',
  phases: [
    { title: 'BuildTool', detail: 'TDD-build packages/bosun in ordered modules: spec+config(pure eval)+lock, providers, reconcilers(+prune), health+CLI', model: 'sonnet' },
    { title: 'ToolValidate', detail: 'Adversarial: prune logic is label/tag-scoped and unit-tested; run the local tool acceptance tests + bd-close', model: 'haiku' },
    { title: 'Artifacts', detail: 'Author deploy.config.ts, web/api/storybook Dockerfiles, path-filtered CI workflow, bootstrap.sh, interactive save-*.sh', model: 'sonnet' },
    { title: 'Gates', detail: 'bun run test && typecheck && biome; ac_gates', model: 'haiku' },
    { title: 'CI', detail: 'Push branch, gh run watch, manifest-inspect all three :<sha> GHCR tags; ac_images + ac_ci_selective', model: 'sonnet' },
    { title: 'HumanGate', detail: 'Report the web-console gates only Calum can clear; STOP unless args.live', model: 'haiku' },
    { title: 'Preflight', detail: 'Verify the box can pull images + op session + swarm reachable before any prune-capable deploy', model: 'sonnet' },
    { title: 'Deploy', detail: 'Bootstrap swarm+Portainer, bosun up over SSH, reconcile routes; tool_up/stack_up/healthchecks/secret+route prune/portainer/storybook/tunnel', model: 'sonnet' },
    { title: 'App', detail: 'agent-browser true 1366x1024 render + live HA value through the stack', model: 'haiku' },
    { title: 'Security', detail: 'gitleaks + no secret values in tree/history, no public inbound, api private', model: 'haiku' },
    { title: 'Resilience', detail: 'pg survives redeploy, orb restart self-heals (HA+Tailscale untouched), autostart verify', model: 'sonnet' },
    { title: 'Lifecycle', detail: 'config change <30s, code push auto-deploy, rollback to prior sha', model: 'sonnet' },
    { title: 'Capstone', detail: 'Confirm every ticket closed or honestly [-]; open the PR; report ac_main_clean as [-] awaiting Calum merge', model: 'haiku' },
  ],
}

const REPO = '/Users/calum/code/github.com/0x63616c/control-center'

// Model tiers (same hard rule as ship): haiku is a good validator but a bad
// coder, so it never writes code here. sonnet writes ALL code + drives SSH/infra
// ops; haiku runs the acceptance tests, judges, and does bd/checklist bookkeeping.
const WORK_M = 'sonnet' // all code-writing + infra ops. NEVER haiku.
const VAL_M = 'haiku' // run acceptance tests, judge, bd/checklist bookkeeping.

// args (all optional):
//   live          true -> run the live homelab deploy + verification phases (default false: software side only, then STOP at the human gate)
//   resumeFromRunId is passed to the Workflow tool, not here; it replays the cached software build so the live re-run is cheap.
//   maxFixRounds  cap on fix rounds per fixable failure batch (default 2)
//   push          true -> also push the branch in CI phase (default true: CI needs the branch on the remote to build). Capstone never pushes to main.
const LIVE = args?.live === true
const MAX_FIX_ROUNDS = args?.maxFixRounds ?? 2

const EPIC = 'www-5ag'

// Shared rules every agent inherits, so behavior never drifts. Deploy-flavored:
// adds the bosun context, SSH-to-homelab, 1Password/op, and the no-secrets-in-git
// invariant on top of the repo's bun/TDD/no-fake-data/beads baseline.
const RULES = `
You are an autonomous deploy engineer on the control-center repo at ${REPO} (a git worktree on a feature branch — do NOT switch to main).

MISSION: drive the bosun/Swarm deploy epic ${EPIC} to done. The full design is docs/deployment-design.md (follow its Part 14 order). The DEFINITION OF DONE is docs/acceptance-checklist.md — it is the single source of truth for every test command and pass condition. Read the relevant item there before validating it; never duplicate or weaken its test.

ABSOLUTE RULES:
- bun/bunx ALWAYS. NEVER npm/npx. The tool runs as \`bun run bosun <cmd>\` (root package.json script "bosun": "bun packages/bosun/src/cli.ts").
- TDD for the tool: write the vitest test FIRST (red), then implement to green. bosun unit tests live in packages/bosun/test/*.test.ts. Run them with \`bun run --cwd packages/bosun test\` (vitest). NEVER bare \`bun test\` — Bun's native runner breaks vi.mock with false failures.
- GATES: \`bun run typecheck\` && \`bunx biome check .\` (\`bunx biome check --write .\` to auto-fix) && \`bun run test\` must all exit 0.
- ZERO fake/hardcoded/placeholder data (web + api + tool). No FALLBACK/PLACEHOLDER identifiers, no DEMO_ outside the two sanctioned service files, no .skip/xfail, no weakening a test or the tool's prune scope to pass. The pre-commit guard (scripts/check-fake-data.sh via lefthook) enforces this.
- SECRETS: never a secret VALUE in git, CI, images, or deploy.config.ts — references only. New credentials (Postgres password, Portainer admin, GHCR pull token) are generated and stored in 1Password (Homelab vault) via the op CLI, each with an interactive scripts/save-<thing>.sh per the using-1password convention. The local op is a 24h-caching PATH shim — invalidate on write. NEVER read .env/.kamal/secrets/*.pem/*.key.
- PRUNE SAFETY (design Part 13 risk #6): bosun's secret/route prune is the dangerous part. It MUST be label/tag-scoped (bosun.stack=control-center) so it can never touch another stack's or Portainer's secrets/routes, and it MUST be unit-tested BEFORE it ever points at the real swarm.
- Code style: imports at top only; no module-global mutable vars; comments explain WHY not HOW, one line.
- BEADS is the shared state. The epic ${EPIC} has 29 children www-5ag.* — one per acceptance criterion. \`bd show <id>\` for a ticket's acceptance. When an item's exact checklist test actually runs and passes, flip its marker to [x] in docs/acceptance-checklist.md (cite the command + observed result inline) and \`bd close <id>\`. If an item is genuinely blocked by a human-only/web-console action, set its marker to [-] WITH a parenthesized reason and leave the ticket open with a \`bd update <id> --notes\` explaining the block. NEVER mark [x] without transcript evidence; NEVER mark a skip as [x]. Do NOT use TodoWrite.
- Commit per phase with a focused conventional-commit message scoped to the work. Do NOT push to main and do NOT open/merge a PR except where a phase explicitly says so.

INFRA (only relevant in live phases, args.live):
- The homelab Mac Mini is SSH-reachable as \`ssh homelab\` (Tailscale), runs OrbStack (Docker + single-node Swarm). Run docker/stack/orb commands there over SSH.
- Your shell has Calum's \`op\` session and \`gh\` auth, and the Cloudflare API token is in 1Password (op://Homelab/Cloudflare API). The tunnel is evee-webhooks (remote-managed); routes are reconciled by bosun, never hand-edited.
- Public names are single-level *.worldwidewebb.co (dashboard., storybook., portainer., hooks.) for free Cloudflare edge HTTPS.
`

// ---- schemas -------------------------------------------------------------

// Coding-agent structured handoff.
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    gatesPass: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    commit: { type: 'string' },
    summary: { type: 'string' },
    followups: { type: 'string', description: 'Anything left undone or new bd issues filed' },
  },
  required: ['status', 'summary'],
}

// One acceptance-criterion verdict (the validator both runs the exact checklist
// test AND does the bd/checklist bookkeeping, then reports this).
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticket: { type: 'string' },
    ac: { type: 'string', description: 'the ac_* key' },
    marker: { type: 'string', enum: ['x', '-', 'todo'], description: 'x=passed+evidence, -=human-gated skip with reason, todo=not yet passing (fixable)' },
    evidence: { type: 'string', description: 'verbatim command(s) + observed result that justify the marker' },
    reason: { type: 'string', description: 'required when marker is "-" or "todo": why it is skipped or still failing' },
    bdClosed: { type: 'boolean' },
  },
  required: ['ticket', 'ac', 'marker', 'evidence', 'bdClosed'],
}

// Adversarial review of the tool's prune scope before any live contact.
const PRUNE_AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    labelScoped: { type: 'boolean', description: 'true iff secret AND route prune filter strictly by the bosun.stack label/tag' },
    unitTested: { type: 'boolean', description: 'true iff a vitest proves an unlabelled/foreign secret+route is left untouched while a declared orphan is pruned' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, description: { type: 'string' }, suggestedFix: { type: 'string' } },
        required: ['severity', 'description'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['labelScoped', 'unitTested', 'findings', 'summary'],
}

// ---- acceptance-criterion catalog ----------------------------------------
// Maps each child ticket to its ac_* key and the phase it is verified in.
// The exact test + pass condition is NOT duplicated here — the validator reads
// docs/acceptance-checklist.md (single source of truth) by key. gate=true marks
// the items most likely to need a Calum-only action (honest [-] if so).
const AC = [
  { t: 'www-5ag.1', k: 'ac_tool_build', phase: 'ToolValidate' },
  { t: 'www-5ag.3', k: 'ac_tool_plan_pure', phase: 'ToolValidate' },
  { t: 'www-5ag.4', k: 'ac_tool_providers', phase: 'ToolValidate' },
  { t: 'www-5ag.7', k: 'ac_tool_health', phase: 'ToolValidate' },
  { t: 'www-5ag.22', k: 'ac_config_pure', phase: 'ToolValidate' },
  { t: 'www-5ag.10', k: 'ac_gates', phase: 'Gates' },
  { t: 'www-5ag.2', k: 'ac_images', phase: 'CI' },
  { t: 'www-5ag.9', k: 'ac_ci_selective', phase: 'CI' },
  { t: 'www-5ag.8', k: 'ac_tool_up', phase: 'Deploy' },
  { t: 'www-5ag.11', k: 'ac_stack_up', phase: 'Deploy' },
  { t: 'www-5ag.12', k: 'ac_healthchecks', phase: 'Deploy' },
  { t: 'www-5ag.5', k: 'ac_tool_secret_sync_prune', phase: 'Deploy' },
  { t: 'www-5ag.6', k: 'ac_tool_routes_sync_prune', phase: 'Deploy' },
  { t: 'www-5ag.13', k: 'ac_portainer_https', phase: 'Deploy' },
  { t: 'www-5ag.14', k: 'ac_portainer_login', phase: 'Deploy', gate: true },
  { t: 'www-5ag.15', k: 'ac_storybook', phase: 'Deploy' },
  { t: 'www-5ag.16', k: 'ac_tunnel', phase: 'Deploy' },
  { t: 'www-5ag.17', k: 'ac_dashboard_render', phase: 'App' },
  { t: 'www-5ag.18', k: 'ac_live_ha', phase: 'App' },
  { t: 'www-5ag.19', k: 'ac_no_secrets_git', phase: 'Security' },
  { t: 'www-5ag.20', k: 'ac_no_inbound', phase: 'Security' },
  { t: 'www-5ag.21', k: 'ac_api_private', phase: 'Security' },
  { t: 'www-5ag.23', k: 'ac_pg_persists', phase: 'Resilience' },
  { t: 'www-5ag.24', k: 'ac_restart_recovers', phase: 'Resilience' },
  { t: 'www-5ag.25', k: 'ac_autostart', phase: 'Resilience', gate: true },
  { t: 'www-5ag.26', k: 'ac_config_speed', phase: 'Lifecycle' },
  { t: 'www-5ag.27', k: 'ac_code_auto', phase: 'Lifecycle', gate: true },
  { t: 'www-5ag.28', k: 'ac_rollback', phase: 'Lifecycle' },
  { t: 'www-5ag.29', k: 'ac_main_clean', phase: 'Capstone' },
]
const acFor = (phaseTitle) => AC.filter((a) => a.phase === phaseTitle)

// Validate one acceptance criterion: a fresh haiku agent runs its EXACT checklist
// test, then does the bd-close + checklist-marker bookkeeping, and reports the
// verdict. Honest by construction: [x] only on observed evidence, [-] only with a
// reason. Returns a VERDICT.
function validateAc(a, phaseTitle, extra = '') {
  return agent(
    `${RULES}\n\nVERIFY ONE ACCEPTANCE CRITERION (mechanical + honest; you did NOT build this, so do not assume it works).\nTicket ${a.t}, item ${a.k}.\n1. \`bd show ${a.t}\` and read the ${a.k} item in docs/acceptance-checklist.md for its EXACT test command(s) and pass condition.\n2. Run that exact test from ${REPO} (live items run over \`ssh homelab\`). Capture verbatim output.\n3. Decide the marker HONESTLY:\n   - [x] ONLY if the test ran and met its pass condition in this transcript. Then edit docs/acceptance-checklist.md to flip this item to [x] with the command + observed result inline, and \`bd close ${a.t}\` (note the evidence via \`bd update ${a.t} --notes\`).\n   - [-] ONLY if blocked by a genuine human-only/web-console action (e.g. minting a token in a console, a GitHub package-visibility toggle, a GUI setting). Set the marker to [-] with a parenthesized reason, \`bd update ${a.t} --notes "<block>"\`, leave the ticket open. ${a.gate ? 'This item is FLAGGED as a likely human gate — if it needs a Calum-only action, [-] is the correct honest outcome, do not force it.' : ''}\n   - todo if it simply is not passing yet for a FIXABLE reason (code/config bug) — leave the marker [ ], do not edit it, report the failure so a fixer can address it.\n4. NEVER mark [x] without evidence and NEVER mark a skip as [x] (the Stop-hook evaluator reads only the transcript).${extra ? `\n${extra}` : ''}\nReturn the verdict.`,
    { label: `verify:${a.k}`, phase: phaseTitle, schema: VERDICT_SCHEMA, model: VAL_M },
  )
}

// Drain a batch of fixable (todo) verdicts with a bounded build->re-verify loop,
// so a transient/code failure doesn't strand an otherwise-passing phase.
async function fixAndReverify(todos, phaseTitle) {
  let pending = todos
  let round = 0
  const out = []
  while (pending.length && round < MAX_FIX_ROUNDS) {
    round++
    const list = pending.map((v) => `- ${v.ticket} ${v.ac}: ${v.reason || v.evidence}`).join('\n')
    log(`Fix ${phaseTitle} round ${round}/${MAX_FIX_ROUNDS}: ${pending.length} fixable failure(s).`)
    await agent(
      `${RULES}\n\nFIX PASS (${phaseTitle} round ${round}). These acceptance items failed for fixable reasons:\n${list}\nFor each: reproduce, write/extend a vitest test that fails because of it where applicable (red), fix to green, run gates, commit (fix:). Do NOT push to main. Return the handoff; followups = anything still unresolved.`,
      { label: `fix:${phaseTitle}:r${round}`, phase: phaseTitle, schema: RESULT_SCHEMA, model: WORK_M },
    )
    const re = await parallel(pending.map((v) => () => validateAc(AC.find((a) => a.t === v.ticket), phaseTitle)))
    const reFiltered = re.filter(Boolean)
    out.push(...reFiltered.filter((v) => v.marker !== 'todo'))
    pending = reFiltered.filter((v) => v.marker === 'todo')
  }
  out.push(...pending) // still-todo after cap: surfaced, not dropped
  return out
}

// Run every AC in a phase: validate in parallel, then drain fixables once.
async function runPhaseAcs(phaseTitle) {
  const items = acFor(phaseTitle)
  if (!items.length) return []
  phase(phaseTitle)
  const verdicts = (await parallel(items.map((a) => () => validateAc(a, phaseTitle)))).filter(Boolean)
  const todos = verdicts.filter((v) => v.marker === 'todo')
  const settled = verdicts.filter((v) => v.marker !== 'todo')
  const fixed = todos.length ? await fixAndReverify(todos, phaseTitle) : []
  const all = [...settled, ...fixed]
  log(`${phaseTitle}: ${all.filter((v) => v.marker === 'x').length} passed, ${all.filter((v) => v.marker === '-').length} skipped[-], ${all.filter((v) => v.marker === 'todo').length} still open.`)
  return all
}

// ==========================================================================
// SEGMENT A — software side (always runs; fully autonomous, no live infra)
// ==========================================================================

// --- Phase 1: build the tool, in ordered modules, TDD --------------------
phase('BuildTool')
log('Building packages/bosun (TDD). Ordered so later modules build on earlier types; prune logic gets unit tests before any live swarm contact.')

const TOOL_STEPS = [
  {
    key: 'spec-config',
    brief:
      'spec.ts (the typed builder API configs import: stack/service/postgres/fromOp/ghcr/httpProbe/cmdProbe -> a static Spec), config.ts (load + PURELY evaluate a deploy.config.ts into that Spec — no I/O, deterministic), and an optional deploy.lock.json snapshot. Unit tests: a config evaluates to a stable, value-free Spec; two evals are byte-identical; evaluation performs no network (stub/forbid it). This satisfies the shape behind ac_tool_plan_pure + ac_config_pure.',
  },
  {
    key: 'providers',
    brief:
      'providers/op.ts, file.ts, env.ts implementing one SecretProvider interface (resolve a reference like op://Homelab/Item/field -> a value). Unit tests resolve a known reference through each (mock the op CLI / use a fixture file / set an env var). Satisfies ac_tool_providers.',
  },
  {
    key: 'reconcile',
    brief:
      'reconcile/secrets.ts (name each cc_<name>_<shorthash> labelled bosun.stack=control-center; create declared, render refs, PRUNE only stack-labelled orphans), reconcile/routes.ts (create declared Cloudflare routes, prune only stack-tagged orphans), reconcile/stack.ts (render Spec -> stack.yml -> docker stack deploy --prune). CRITICAL: prune is strictly label/tag-scoped and MUST have vitest proving a foreign/unlabelled secret AND route are left untouched while a declared orphan is pruned (mock the docker/CF clients — no real swarm). Satisfies the unit half of ac_tool_secret_sync_prune + ac_tool_routes_sync_prune and de-risks the live deploy.',
  },
  {
    key: 'health-cli',
    brief:
      'health.ts (run declared httpProbe/cmdProbe probes -> exit code + per-probe report; exit 0 iff all pass) and cli.ts dispatching plan | secrets sync | routes sync | up | verify | serve, plus the root package.json "bosun" script and a packages/bosun typecheck script. Unit test: verify exits 0 when all probes pass and non-zero with a clear report when one is flipped impossible. Satisfies ac_tool_health + wires ac_tool_up/ac_tool_build.',
  },
]
for (const s of TOOL_STEPS) {
  await agent(
    `${RULES}\n\nBUILD MODULE: ${s.key}. Follow the packages/bosun layout in design doc Part 5.1.\n${s.brief}\nWork TDD (vitest test first, red -> green). Keep the module focused; imports at top only. Run \`bun run --cwd packages/bosun typecheck\` and \`bun run --cwd packages/bosun test\` green before finishing, then commit (feat(bosun): ${s.key}). Do NOT push. Return the handoff.`,
    { label: `build:${s.key}`, phase: 'BuildTool', schema: RESULT_SCHEMA, model: WORK_M },
  )
}

// Adversarial gate: prune scope MUST be label/tag-scoped + unit-tested before we
// ever let this tool touch the real swarm. A fresh reviewer that did not write it.
phase('ToolValidate')
let pruneAudit = await agent(
  `${RULES}\n\nPRUNE-SCOPE AUDIT (no ticket; you did NOT write this — be adversarial). Inspect packages/bosun/src/reconcile/secrets.ts and routes.ts and their tests. Verify: (a) prune filters STRICTLY by the bosun.stack=control-center label/tag, so it can never delete another stack's or Portainer's secrets/routes; (b) a vitest actually proves an unlabelled/foreign secret AND route survive a sync while a declared orphan is pruned. Any gap is a blocker finding. Return the audit.`,
  { label: 'audit:prune-scope', phase: 'ToolValidate', schema: PRUNE_AUDIT_SCHEMA, model: VAL_M },
)
let pruneRound = 0
while ((!pruneAudit.labelScoped || !pruneAudit.unitTested) && pruneRound < MAX_FIX_ROUNDS) {
  pruneRound++
  const list = pruneAudit.findings.map((f) => `- [${f.severity}] ${f.description}${f.suggestedFix ? ` -> ${f.suggestedFix}` : ''}`).join('\n')
  log(`Prune-scope NOT safe yet (round ${pruneRound}): labelScoped=${pruneAudit.labelScoped} unitTested=${pruneAudit.unitTested}. Hardening before any live contact.`)
  await agent(
    `${RULES}\n\nHARDEN PRUNE SCOPE (round ${pruneRound}). The prune logic is not provably safe yet:\n${list}\nMake prune strictly label/tag-scoped and add vitest proving foreign/unlabelled secrets AND routes survive while declared orphans are pruned (mock docker/CF clients). Gates green, commit (fix(bosun): prune scope). Return the handoff.`,
    { label: `fix:prune:r${pruneRound}`, phase: 'ToolValidate', schema: RESULT_SCHEMA, model: WORK_M },
  )
  pruneAudit = await agent(
    `${RULES}\n\nRE-AUDIT prune scope (round ${pruneRound}) exactly as before. Return the audit.`,
    { label: `audit:prune-scope:r${pruneRound}`, phase: 'ToolValidate', schema: PRUNE_AUDIT_SCHEMA, model: VAL_M },
  )
}
if (!pruneAudit.labelScoped || !pruneAudit.unitTested) {
  log(`WARNING: prune scope still not provably safe after ${MAX_FIX_ROUNDS} rounds. The live Deploy phase will be gated off until this is fixed — NOT silently proceeding.`)
}

// Local tool acceptance items (build/plan-pure/providers/health/config-pure).
const toolVerdicts = await runPhaseAcs('ToolValidate')

// --- Phase 3: author the deploy artifacts --------------------------------
phase('Artifacts')
log('Authoring deploy.config.ts, Dockerfiles, CI, bootstrap, and interactive save-scripts.')
const ARTIFACTS = [
  {
    key: 'config-dockerfiles',
    brief:
      'deploy.config.ts at repo root (design Part 6): web (route dashboard.worldwidewebb.co, reverse-proxy /api -> api:4201), api (ghcr image, internal-only, HA via host.docker.internal:8123, secret REFERENCES from tilt/op-secrets.tpl + the evee connector token — references only, never values), postgres (pinned, pgdata volume, postgresql.conf via docker config, initdb), cloudflared (pinned, connector token ref), storybook (route storybook.worldwidewebb.co); plus apps/web, apps/api, and storybook multi-stage bun Dockerfiles (web serves static + reverse-proxies /api; api entrypoint runs db:migrate then starts). \`bun run bosun plan\` must succeed, be byte-identical across two runs, and contain zero secret values.',
  },
  {
    key: 'ci-bootstrap-scripts',
    brief:
      '.github/workflows/ CI (design Part 7): on push, path-filtered per-app builds via dorny/paths-filter (only changed apps rebuild; packages/** or root lockfile rebuild all; docs-only -> no image build) -> push ghcr.io/0x63616c/control-center-{web,api,storybook}:<sha> and :main with buildx layer cache -> after push, POST the deploy webhook (hooks.worldwidewebb.co). scripts/bootstrap.sh (idempotent: swarm init if needed, Portainer monitoring service, first bosun up). Interactive scripts/save-<thing>.sh for each NEW credential (postgres password, portainer admin, ghcr pull token) that generates + stores it in 1Password Homelab via op — never echoing the value into git.',
  },
]
await parallel(
  ARTIFACTS.map((s) => () =>
    agent(
      `${RULES}\n\nAUTHOR ARTIFACT SET: ${s.key}.\n${s.brief}\nNo secret VALUES anywhere — references only; the pre-commit guard must stay green. Typecheck where applicable, commit (feat(deploy): ${s.key}). Do NOT push. Return the handoff.`,
      { label: `artifact:${s.key}`, phase: 'Artifacts', schema: RESULT_SCHEMA, model: WORK_M },
    ),
  ),
)

// --- Phase 4: full-repo gates --------------------------------------------
const gateVerdicts = await runPhaseAcs('Gates')

// --- Phase 5: push branch -> CI -> GHCR ----------------------------------
phase('CI')
log('Pushing the branch and driving CI to build all three images to GHCR.')
await agent(
  `${RULES}\n\nCI DRIVER. Push the CURRENT feature branch (NOT main): \`git push -u origin HEAD\`. Then trigger/observe the image build: find the run (\`gh run list\`), \`gh run watch <id>\` to conclusion. This phase only needs the branch on the remote so CI runs; it does NOT merge to main. Report the run id + conclusion and the GHCR tags produced. Return the handoff (followups = any CI failures to fix).`,
  { label: 'ci:push-watch', phase: 'CI', schema: RESULT_SCHEMA, model: WORK_M },
)
const ciVerdicts = await runPhaseAcs('CI')

// --- Phase 6: the human gate ---------------------------------------------
// Everything the dev machine can do autonomously is done. What remains before a
// live deploy are web-console actions only Calum can take. Compute that report
// and, unless args.live, STOP here cleanly (resume after Calum clears them).
phase('HumanGate')
const gateReport = await agent(
  `${RULES}\n\nHUMAN-GATE REPORT (read-only; make NO changes). The software side is built and CI has pushed images. Before a live deploy can pull + run them on the homelab swarm, determine precisely which actions require Calum in a web console and cannot be done from this shell:\n1. GHCR pull auth: are the three ghcr.io/0x63616c/control-center-* packages pullable by the box? (\`gh\` to check package visibility.) If they are private with no pull credential available, Calum must either set them public or mint a pull PAT in the GitHub UI — state which.\n2. op service-account token: only needed for the ON-BOX bosun-agent auto-deploy (ac_code_auto). Local \`bosun up\` does not need it. Note whether it exists; if not, it is minted in the 1Password console.\n3. OrbStack start-at-login (ac_autostart) is verify-only — note its current state.\nReturn a handoff: summary = a crisp numbered list of EXACTLY what Calum must do (with where), followups = anything else blocking live.`,
  { label: 'human-gate:report', phase: 'HumanGate', schema: RESULT_SCHEMA, model: VAL_M },
)

const segmentA = {
  epic: EPIC,
  toolVerdicts,
  gateVerdicts,
  ciVerdicts,
  pruneSafe: pruneAudit.labelScoped && pruneAudit.unitTested,
  humanGate: gateReport.summary,
}

if (!LIVE) {
  log('Software side complete. STOPPING at the human gate — re-invoke with args.live=true + resumeFromRunId=<this run> after clearing the gates below.')
  return {
    segment: 'A (software side)',
    status: 'blocked-on-calum',
    ...segmentA,
    nextStep:
      'Clear the human-gate actions, then resume: Workflow({ scriptPath: <this script>, args: { live: true }, resumeFromRunId: <runId> }). The cached build replays instantly; only the live phases run.',
  }
}

// ==========================================================================
// SEGMENT B — live deploy + verification (args.live; Calum has cleared gates)
// ==========================================================================
// Calum passing args.live=true IS the explicit authorization for the first
// prune-capable deploy against the live swarm (the pre-deploy checkpoint).

if (!segmentA.pruneSafe) {
  log('REFUSING live deploy: bosun prune scope is not provably label-scoped + unit-tested. Fix that first (design Part 13 risk #6). Returning without touching the swarm.')
  return { segment: 'B aborted', status: 'unsafe-prune', ...segmentA }
}

// --- Preflight: prove the box can pull + op + swarm before any mutation ---
phase('Preflight')
const preflight = await agent(
  `${RULES}\n\nPREFLIGHT (read-mostly; no prune, no deploy yet). Over \`ssh homelab\` verify the box is ready for a live deploy: (a) OrbStack/docker is up and \`docker info\` shows Swarm active (if not, \`docker swarm init\`); (b) the three ghcr.io/0x63616c/control-center-* images at the current HEAD sha are PULLABLE on the box (\`docker pull\` one to prove auth); (c) your \`op\` session resolves a known Homelab reference. If pull fails on auth, STOP and report it as blocked (Calum's GHCR gate is not actually cleared). Return the handoff: status=done only if all three hold.`,
  { label: 'preflight', phase: 'Preflight', schema: RESULT_SCHEMA, model: WORK_M },
)
if (preflight.status !== 'done') {
  log(`Preflight not satisfied: ${preflight.summary}. Not deploying. Resume after the gap is cleared.`)
  return { segment: 'B halted at preflight', status: 'blocked-on-calum', preflight, ...segmentA }
}

// --- Deploy: bootstrap + bosun up + reconcile, then verify the C/D items --
phase('Deploy')
log('Bootstrapping the swarm and running the first live bosun up.')
await agent(
  `${RULES}\n\nLIVE DEPLOY (over \`ssh homelab\`). This is the first prune-capable run against the real swarm — Calum authorized it by launching with live=true. Steps:\n1. Run scripts/bootstrap.sh idempotently: ensure Swarm active, the Portainer monitoring service is up (no deploys), then the first \`bun run bosun up\`.\n2. \`bun run bosun up\` must do plan -> secrets sync (resolve refs via op -> label-scoped docker secrets, prune scoped orphans) -> routes sync (Cloudflare) -> docker stack deploy --prune -> verify, bringing control-center all-healthy.\n3. Resolve any deploy failures (image pull, migrate-on-boot ordering, healthcheck) and re-run until the stack is up. Commit any config/script fixes (fix(deploy):). Do NOT push to main.\nReturn the handoff: status=done only if \`docker stack services control-center\` shows every service 1/1 and \`bosun verify\` exits 0.`,
  { label: 'deploy:bosun-up', phase: 'Deploy', schema: RESULT_SCHEMA, model: WORK_M },
)
const deployVerdicts = await runPhaseAcs('Deploy')

// --- App / Security / Resilience / Lifecycle -----------------------------
const appVerdicts = await runPhaseAcs('App')
const securityVerdicts = await runPhaseAcs('Security')
const resilienceVerdicts = await runPhaseAcs('Resilience')
const lifecycleVerdicts = await runPhaseAcs('Lifecycle')

// --- Capstone: confirm + open the PR (Calum merges) ----------------------
phase('Capstone')
const liveVerdicts = [...deployVerdicts, ...appVerdicts, ...securityVerdicts, ...resilienceVerdicts, ...lifecycleVerdicts]
const allVerdicts = [...toolVerdicts, ...gateVerdicts, ...ciVerdicts, ...liveVerdicts]
const stillOpen = allVerdicts.filter((v) => v.marker === 'todo')
const skipped = allVerdicts.filter((v) => v.marker === '-')

const capstone = await agent(
  `${RULES}\n\nCAPSTONE (bookkeeping). The deploy is built, deployed, and verified. Finish the epic honestly:\n1. \`bd epic status ${EPIC}\` — report remaining-open children. Closed/[ -] count: ${allVerdicts.filter((v) => v.marker === 'x').length} passed, ${skipped.length} honest [-], ${stillOpen.length} still open${stillOpen.length ? ` (${stillOpen.map((v) => v.ticket).join(', ')})` : ''}.\n2. Final gates: \`bun run typecheck\` && \`bunx biome check .\` && \`bun run test\`; report verbatim pass/fail.\n3. ac_main_clean (www-5ag.29): we are landing via PR, so this stays [-] until Calum merges. Set its checklist marker to [-] with reason "(awaiting Calum PR merge)" and \`bd update www-5ag.29 --notes\`; do NOT mark it [x].\n4. Open the PR from the current branch to main: \`gh pr create --base main --title "feat: deploy control-center via bosun (${EPIC})" --body "<summary of what shipped, the AC tally, the honest [-] items with reasons, and that ac_main_clean completes on merge>"\`. Do NOT merge it.\nReturn the handoff: summary = the AC tally + PR url, followups = the still-open + [-] items.`,
  { label: 'capstone', phase: 'Capstone', schema: RESULT_SCHEMA, model: VAL_M },
)

return {
  segment: 'B (live deploy)',
  epic: EPIC,
  status: stillOpen.length ? 'partial' : 'complete-pending-merge',
  tally: {
    passed: allVerdicts.filter((v) => v.marker === 'x').length,
    skipped: skipped.map((v) => `${v.ticket} ${v.ac}: ${v.reason || ''}`),
    stillOpen: stillOpen.map((v) => `${v.ticket} ${v.ac}: ${v.reason || ''}`),
  },
  humanGate: segmentA.humanGate,
  capstone,
}
