export const meta = {
  name: 'structured-logging',
  description: 'Adopt pino structured logging across every backend service: explore → plan → adversarial review → tickets → build → gates → commit',
  whenToUse: 'After scoping the structured-logging epic. Pass args.epic=<epicId>. Explores current logging, writes a maintainable plan, has a fresh agent review+fix it, files child bd tickets, builds a shared logger primitive, adopts it in api/worker/media-worker/bosun, runs gates to green, and commits per ticket. Does NOT push or deploy , the caller merges/deploys/verifies.',
  phases: [
    { title: 'Explore', detail: 'parallel readers map current logging + gaps per service' },
    { title: 'Plan', detail: 'synthesize a sustainable structured-logging plan + write docs/logging.md' },
    { title: 'Review', detail: 'fresh adversarial agent critiques the plan; apply fixes' },
    { title: 'Tickets', detail: 'file child bd tickets under the epic' },
    { title: 'Foundation', detail: 'build the shared logger primitive + tests' },
    { title: 'Implement', detail: 'one agent per service adopts the logger, adds debug/error/lifecycle logs' },
    { title: 'Gates', detail: 'typecheck/test/biome/knip to green (fix loop)' },
    { title: 'Commit', detail: 'serial per-ticket commits (type(area/www-xxx))' },
  ],
}

const EPIC = (args && args.epic) || 'www-rw07'

// Backend services that produce pod logs (web is browser-side, handled as a thin separate logger).
const SERVICES = [
  { key: 'api', dir: 'products/control-center/api', pkg: '@control-center/api', svc: 'control-center_api',
    note: 'tRPC request server (server.ts). Log request lifecycle (method/path/status/ms), tRPC errors, integration failures (HA/etc). Request-only since the worker split.' },
  { key: 'worker', dir: 'products/control-center/worker', pkg: '@control-center/worker', svc: 'control-center_worker',
    note: 'Interval worker runtime (runtime.ts) driving light/climate enforcers, device-sync, party, weather-ingest. CRITICAL GAP: runtime swallows per-cycle errors into in-memory stats and NEVER logs. Log worker start, failure-state transitions (consecutiveFailures crossing 0), and periodic stats snapshots , not 1/sec spam.' },
  { key: 'media-worker', dir: 'products/control-center/media-worker', pkg: '@control-center/media-worker', svc: 'control-center_media-worker',
    note: 'Queue worker (index.ts/runtime.ts) with disk-guard. Log claim/skip decisions, job lifecycle, failures.' },
  { key: 'bosun', dir: 'packages/bosun', pkg: '@repo/bosun', svc: 'control-center_bosun-agent',
    note: 'Deploy agent + in-process cron scheduler + secrets reconcile (32 console.* calls). README already promises "every decision is logged ... verifiable from docker service logs". Make those structured. NEVER log resolved secret values.' },
]

const EXPLORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'summary', 'currentLogging', 'gaps', 'secrets'],
  properties: {
    service: { type: 'string' },
    summary: { type: 'string', description: 'what this service does at runtime, 2-3 sentences' },
    currentLogging: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'level', 'message'],
        properties: { file: { type: 'string' }, level: { type: 'string' }, message: { type: 'string' } },
      },
      description: 'every existing console.* (or other logging) call, with file:line',
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['where', 'whatToLog', 'level', 'why'],
        properties: {
          where: { type: 'string', description: 'file/function/lifecycle point' },
          whatToLog: { type: 'string' },
          level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
          why: { type: 'string', description: 'how it helps debug a live system' },
        },
      },
      description: 'places that SHOULD log but do not , lifecycle, decisions, errors, slow paths',
    },
    secrets: { type: 'array', items: { type: 'string' }, description: 'values that must be redacted/never logged in this service' },
  },
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['loggerModule', 'conventions', 'perService', 'docsWritten', 'tickets'],
  properties: {
    loggerModule: { type: 'string', description: 'where the shared logger lives + its exact API surface (factory signature, child-logger pattern, level/format/redaction config)' },
    conventions: { type: 'string', description: 'levels, standard fields (service,env,context ids,durationMs), dev pretty vs prod JSON, redaction, how secrets are kept out' },
    perService: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['service', 'changes'],
        properties: { service: { type: 'string' }, changes: { type: 'string', description: 'concrete logger adoption + new logs for this service' } },
      },
    },
    docsWritten: { type: 'string', description: 'path to the written plan doc' },
    tickets: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'title', 'area', 'acceptance'],
        properties: {
          key: { type: 'string', description: 'short slug e.g. foundation, api, worker' },
          title: { type: 'string' },
          area: { type: 'string', description: 'commit-scope area e.g. logging, worker, bosun' },
          acceptance: { type: 'string', description: 'machine-checkable AC for this child ticket' },
        },
      },
      description: 'proposed child tickets: a foundation ticket + one per service + a docs ticket',
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'approve-with-fixes', 'reject'] },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'concrete change to make to the plan/doc before implementation' },
        },
      },
    },
  },
}

const TICKETS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['created'],
  properties: {
    created: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'id', 'area'],
        properties: { key: { type: 'string' }, id: { type: 'string' }, area: { type: 'string' } },
      },
    },
  },
}

const GATES_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['green', 'ran', 'remainingFailures'],
  properties: {
    green: { type: 'boolean' },
    ran: { type: 'array', items: { type: 'string' } },
    remainingFailures: { type: 'array', items: { type: 'string' } },
  },
}

const REPO_RULES = `
Repo rules you MUST follow (control-center):
- bun/bunx only, never npm/npx. Test runner is "bun run test" (vitest), NEVER bare "bun test".
- ZERO fake/hardcoded data. Uppercase FALLBACK/PLACEHOLDER identifiers and DEMO_/demo_ outside sanctioned files are blocked by a pre-commit grep.
- No secrets in code or logs , redact. gitleaks pre-commit guard is active.
- Dead-code guard: knip runs in pre-push + CI and fails on ANY unused file/export/dep. A deliberate public export with no consumer yet needs a /** @public , reason */ JSDoc tag. New runtime deps with no JS import edge go in knip.jsonc ignoreDependencies.
- biome is the lint/format gate (bunx biome check .).
- Imports at top of file only; comments explain WHY not HOW; no module-global mutable state.
- Commit subjects MUST be type(area/www-xxx): a Conventional Commit whose scope ends with a real bd ticket id, e.g. feat(logging/www-rw07.2): ...
`

// ── Phase 1: Explore ──────────────────────────────────────────────────────
phase('Explore')
const findings = await parallel(
  SERVICES.map((s) => () =>
    agent(
      `You are exploring the control-center repo to map the CURRENT logging situation for the "${s.key}" service (${s.dir}).\n\n` +
      `Service context: ${s.note}\n\n` +
      `Read the source under ${s.dir}/src. Find EVERY existing logging call (console.* etc.) with file:line and level. ` +
      `Then identify the GAPS: lifecycle moments (startup/shutdown/config), decisions, error paths, slow/retry paths, and reconcile/cycle outcomes that SHOULD emit a structured log so a human can debug this running in production but currently emit nothing. ` +
      `Be concrete and specific to the real code you read. List any secret/sensitive values that must never be logged.\n\n` +
      `Return ONLY the structured findings.`,
      { label: `explore:${s.key}`, phase: 'Explore', model: 'sonnet', schema: EXPLORE_SCHEMA, agentType: 'Explore' },
    ),
  ),
)
const realFindings = findings.filter(Boolean)
log(`Explored ${realFindings.length}/${SERVICES.length} services; ${realFindings.reduce((n, f) => n + f.gaps.length, 0)} logging gaps found`)

// ── Phase 2: Plan ─────────────────────────────────────────────────────────
phase('Plan')
const plan = await agent(
  `You are the architect for adopting structured logging across the control-center backend. ${REPO_RULES}\n\n` +
  `Here is the exploration of current logging + gaps per service:\n${JSON.stringify(realFindings, null, 2)}\n\n` +
  `Design a MAINTAINABLE, SUSTAINABLE structured-logging system and WRITE IT to docs/logging.md (create the file). Decisions to make and justify:\n` +
  `1. Library: pino (already chosen in www-355t.44). Where the SHARED logger primitive lives so api, worker, media-worker AND bosun can all import it without circular deps or duplicate config. Options: a new packages/logger workspace, or a shared module. Pick one and justify (knip-clean, no cross-app coupling).\n` +
  `2. Exact API surface: a createLogger/getLogger factory, child-logger pattern for per-request / per-worker context, standard bound fields (service, env). Show the TypeScript signature.\n` +
  `3. Format: pino-pretty in dev (NODE_ENV!=production), JSON in prod. Levels policy (when to use debug/info/warn/error). Log level from env.\n` +
  `4. Redaction: pino redact paths + the rule that resolved secrets/tokens are NEVER logged. List sensitive fields.\n` +
  `5. Per-service adoption: for EACH of api/worker/media-worker/bosun, exactly what console.* gets replaced and what NEW structured logs get added (especially the worker runtime swallowing errors into invisible stats , fix that with failure-transition + periodic stats logs).\n` +
  `6. How "we know things are working": each service should log a clear startup line and steady-state heartbeat/decision logs that will be visible in docker service logs control-center_<svc>.\n` +
  `7. Web (browser) is OUT of pod scope , note briefly how a thin browser logger could replace its console.* later, but it is not the focus.\n\n` +
  `Also propose the child bd tickets: a "foundation" ticket (shared logger) + one per backend service + a docs ticket. Keep AC machine-checkable.\n\n` +
  `Write docs/logging.md now, then return the structured plan.`,
  { label: 'plan:author', phase: 'Plan', schema: PLAN_SCHEMA },
)
log(`Plan written to ${plan.docsWritten}; ${plan.tickets.length} child tickets proposed`)

// ── Phase 3: Review (fresh adversarial agent) → apply fixes ───────────────
phase('Review')
const review = await agent(
  `You are a FRESH, skeptical staff engineer reviewing a structured-logging plan for control-center BEFORE any code is written. ${REPO_RULES}\n\n` +
  `The plan doc is at ${plan.docsWritten} , READ IT from disk. Plan summary:\n${JSON.stringify(plan, null, 2)}\n\n` +
  `Critique for MAINTAINABILITY and SUSTAINABILITY and repo-fit. Hunt specifically for: cross-package coupling or circular-dep risk in the chosen logger location; knip violations (unused exports without @public, deps without import edges); anything that would break a repo guard (fake-data, gitleaks, commit-msg, scheduler); secrets that could leak into logs; log spam (e.g. 1/sec worker cycle logs); levels misused; missing redaction; whether each pod will actually show useful logs; whether the API surface is ergonomic enough that engineers will actually use it instead of console.*. ` +
  `Return a verdict and a concrete, actionable issue list (each with a fix).`,
  { label: 'review:plan', phase: 'Review', schema: REVIEW_SCHEMA },
)
const mustFix = review.issues.filter((i) => i.severity !== 'minor')
log(`Review verdict=${review.verdict}; ${review.issues.length} issues (${mustFix.length} blocker/major)`)
if (review.issues.length > 0) {
  await agent(
    `Apply these review fixes to the structured-logging plan doc at ${plan.docsWritten}. Edit the file in place so the plan is implementation-ready. ${REPO_RULES}\n\n` +
    `Issues to resolve:\n${JSON.stringify(review.issues, null, 2)}\n\n` +
    `Original plan for context:\n${JSON.stringify(plan, null, 2)}\n\n` +
    `Make the doc internally consistent after your edits. Return a short summary of what you changed.`,
    { label: 'review:apply', phase: 'Review' },
  )
  log('Applied review fixes to the plan doc')
}

// ── Phase 4: Tickets ──────────────────────────────────────────────────────
phase('Tickets')
const tickets = await agent(
  `Create child bd (beads) tickets under epic ${EPIC} for the structured-logging work, using the bd CLI via Bash. ${REPO_RULES}\n\n` +
  `Create EXACTLY these children (one bd create each, --type task, -p 1, parented to ${EPIC}). For parenting use the epic's dependency/child mechanism this repo uses (run "bd create --help" if unsure; prefer "bd create ... -p 1" then link as child of ${EPIC} via the dependency command, or the --parent/--epic flag if it exists). Each needs a clear --acceptance (machine-checkable).\n` +
  `Tickets to create:\n${JSON.stringify(plan.tickets, null, 2)}\n\n` +
  `Also: www-355t.44 ("Adopt pino for structured API logging") is now SUPERSEDED by this epic's api child , close it with "bd close www-355t.44 --reason superseded" (or add a comment noting the superseding api ticket id if close needs different flags; check bd close --help).\n\n` +
  `Capture the real assigned id for each ticket from bd's output. Return the key→id map. Do NOT invent ids , only report ids bd actually printed.`,
  { label: 'tickets:create', phase: 'Tickets', model: 'sonnet', schema: TICKETS_SCHEMA },
)
const idFor = Object.fromEntries(tickets.created.map((t) => [t.key, t]))
log(`Created tickets: ${tickets.created.map((t) => `${t.key}=${t.id}`).join(', ')}`)

const foundationTicket = idFor['foundation'] || tickets.created[0]

// ── Phase 5: Foundation (sequential , everything depends on it) ────────────
phase('Foundation')
await agent(
  `Implement the SHARED logger primitive exactly as specified in docs/logging.md (read it from disk first). ${REPO_RULES}\n\n` +
  `This is the foundation every backend service imports, so it must be correct, knip-clean, and ergonomic. Use pino. Add pino (+ pino-pretty as a dev/runtime dep per the plan) to the right package.json. Implement the factory/child-logger API the plan defines, with env-driven level, dev-pretty/prod-JSON transport, and redaction of the sensitive fields the plan lists.\n\n` +
  `Write unit tests for the logger (level resolution, redaction, child binding) runnable via "bun run test". Make sure typecheck and knip will pass (tag deliberate public exports with /** @public , reason */, add pino/pino-pretty to knip.jsonc ignoreDependencies if they have no static import edge).\n\n` +
  `Do NOT wire it into the services yet , just the primitive + tests. Return a summary of files created/changed and the exact import path other services will use.`,
  { label: `foundation:${foundationTicket.id}`, phase: 'Foundation', model: 'sonnet' },
)
log('Shared logger primitive built')

// ── Phase 6: Implement (parallel , one agent per service, disjoint files) ──
phase('Implement')
const implResults = await parallel(
  SERVICES.map((s) => () => {
    const t = idFor[s.key] || { id: EPIC, area: s.key }
    return agent(
      `Adopt the shared structured logger in the "${s.key}" service (${s.dir}) per docs/logging.md (read the doc + the foundation logger's actual API from disk first). ${REPO_RULES}\n\n` +
      `Service context: ${s.note}\n\n` +
      `Do ALL of:\n` +
      `1. Replace every raw console.* in ${s.dir}/src runtime paths with the shared logger at the right level, carrying structured context fields (not string-concat).\n` +
      `2. ADD the new structured logs the plan calls for: a clear startup line, lifecycle (shutdown/config), error paths with the error object, and steady-state "it's working" signals , WITHOUT log spam (e.g. for the worker runtime, log failure-state transitions + periodic stats, not every 1s cycle).\n` +
      `3. Bind a child logger with service/context fields where it makes sense.\n` +
      `4. Keep/extend tests so behavior stays covered and "bun run test" passes for this workspace. Keep typecheck + knip + biome clean.\n\n` +
      `Only touch files under ${s.dir} (and ${s.dir}/package.json for the logger dep). Return a summary of what you changed and which new logs now prove the service is alive.`,
      { label: `impl:${s.key}`, phase: 'Implement', model: 'sonnet' },
    )
  }),
)
log(`Implemented logging in ${implResults.filter(Boolean).length}/${SERVICES.length} services`)

// docs + CLAUDE.md reference (sequential, single writer)
await agent(
  `Finalize documentation for the structured-logging work. ${REPO_RULES}\n\n` +
  `Ensure docs/logging.md reflects what was ACTUALLY implemented (read the foundation logger + each service's changes). Add a short "Logging" section (or one-liner + link to docs/logging.md) to the root CLAUDE.md and to packages/bosun/README.md if relevant, so future agents use the shared logger instead of console.*. Keep it concise and accurate.\n\n` +
  `Return a summary of doc changes.`,
  { label: 'docs:finalize', phase: 'Implement', model: 'sonnet' },
)

// ── Phase 7: Gates (fix loop) ─────────────────────────────────────────────
phase('Gates')
let gates = null
for (let attempt = 1; attempt <= 3; attempt++) {
  gates = await agent(
    `Run the full quality gate for control-center and FIX any failures (attempt ${attempt}/3). ${REPO_RULES}\n\n` +
    `Run, in order, and make each pass:\n` +
    `- bun run typecheck\n` +
    `- bun run test   (vitest; NEVER bare "bun test")\n` +
    `- bunx biome check .   (auto-fix with: bunx biome check --write .)\n` +
    `- bunx knip   (fix dead code; @public tag or knip.jsonc as the plan allows)\n\n` +
    `Fix real failures in the logging code you find , do not weaken or skip tests, do not add coverage thresholds, do not delete the new logs to make a gate pass. If everything is green, report green=true. Report exactly which gates you ran and any failures that remain.`,
    { label: `gates:attempt-${attempt}`, phase: 'Gates', model: 'sonnet', schema: GATES_SCHEMA },
  )
  log(`Gates attempt ${attempt}: green=${gates && gates.green}; remaining=${gates ? gates.remainingFailures.join('; ') : 'n/a'}`)
  if (gates && gates.green) break
}

// ── Phase 8: Commit (serial , one commit per ticket) ──────────────────────
phase('Commit')
const commitSummary = await agent(
  `Commit the structured-logging work in this git worktree as SEPARATE commits, one per ticket, in dependency order. ${REPO_RULES}\n\n` +
  `Commit-msg guard requires subjects of the form type(area/www-xxx): desc with a REAL bd ticket id in the scope. Use these tickets:\n` +
  `- epic: ${EPIC}\n` +
  `- children: ${JSON.stringify(tickets.created)}\n\n` +
  `Plan:\n` +
  `1. First commit the shared logger primitive + its dep + tests under the foundation ticket (${foundationTicket.id}), area "logging".\n` +
  `2. Then one commit per service using that service's ticket id and a sensible area (e.g. fix(worker/CC-...): structured logging). Use "git add <paths>" to stage only that service's files per commit.\n` +
  `3. Commit the docs/CLAUDE.md changes under the docs ticket (or the epic) with area "docs".\n` +
  `Do NOT use --no-verify , let the hooks run. If a hook blocks, fix the cause and retry. After committing, run "git log --oneline -10" and "git status".\n\n` +
  `Return the list of commit subjects you created and confirm "git status" is clean.`,
  { label: 'commit:serial', phase: 'Commit', model: 'sonnet' },
)

return {
  epic: EPIC,
  servicesExplored: realFindings.length,
  reviewVerdict: review.verdict,
  tickets: tickets.created,
  gatesGreen: gates ? gates.green : false,
  gatesRemaining: gates ? gates.remainingFailures : ['gates did not run'],
  commitSummary,
}
