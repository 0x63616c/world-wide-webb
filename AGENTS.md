# Agent instructions

Read `CODEBASE_OVERVIEW.md`, then the product README/local instructions for the area being changed.
Repository consolidation is complete; `docs/plans/monorepo-migration-progress.md` records ownership.
Develop migrated products here, never in deleted source repositories or `github-archive` snapshots.
Tendr’s replacement Cloudflare hosting is tracked separately in #1007.

For Mini deployment, boot recovery or private-image pulls, read `homelab/AGENTS.md` before
changing credentials; it records the existing Comin, SOPS and registry-auth setup.

## Working

Use `wtp add -b codex/<task> origin/main` before edits; use absolute worktree paths.
When resuming, check that the worktree path exists. Hourly cleanup removes clean merged
worktrees and their branches; clean, fully pushed worktrees may be removed after 24 hours
of observed inactivity while keeping their branches. From the main checkout, recreate a
missing worktree with `wtp add codex/<task>`; fetch origin first if the branch is remote-only.
If the branch was merged and deleted, create a new follow-up branch from fresh `origin/main`.
Keep durable release evidence outside disposable worktrees; use `git worktree lock --reason
'retain' <path>` for worktrees that must stay.
Keep the main checkout, other worktrees and branches intact. Use Conventional Commits.
Review your own completed changes; delegated reviews, including Astra, require an explicit user request.
Pass required checks before merging. Never bypass a required check.

Use one quiet tool-side watcher for CI/delivery. Report meaningful stage changes, failures and
completion; avoid repeated unchanged status messages, percentage estimates and model-driven polling.

Prefer substantial working batches, existing product handlers and relevant checks. Reuse valid
exact-source artifacts/evidence. Products own their UI/components, architecture, fixtures and
listing facts. Shared tooling owns process and selection; an unrelated app change must not ship
other products, apply infrastructure or activate hosts. Bun is the JavaScript tooling default;
retain runtimes required by actual product tools.

## Keep implementation simple

- Build the smallest complete solution for the current requirement. Do not build for hypothetical
  future apps, deployments or operators.
- Make permanent product features work by default. Add enablement/verification flags, optional
  bindings or configurable behavior only for a concrete requirement. Report failures instead of
  silently disabling expected features.
- Prefer direct, product-specific code. Add an abstraction only when it removes actual duplication
  or complexity; do not add a wrapper, state machine or framework merely for possible reuse.
- Keep one source of truth and one owner for each process. Extend existing tooling before adding
  another selector, launcher or configuration layer. Remove obsolete paths and temporary migration
  machinery as their replacements take over.
- Verify proportionately: run relevant existing checks and one or two representative core flows for
  the completed batch. Reuse valid passing evidence. Expand testing for changed behavior, real failures
  or concrete unresolved risks; do not routinely add exhaustive matrices, repeated broad suites,
  restore/reboot rehearsals or extra acceptance gates. Documentation-only changes need documentation
  checks, not application builds.
- Keep essential protections for user data, secrets and duplicate physical actions. Simplicity does
  not authorize destructive shortcuts, hidden failures or competing deployment writers.

## Tight development loop

- Start from the source map and the current task's short working note: objective, relevant files,
  decisions, passing checks and next step. Update the existing plan/tracker instead of duplicating
  history. Read deeper documentation only for the affected area or an unresolved question.
- Keep decisions testable with small local fixtures; exercise I/O through existing handlers.
  During iteration run the affected tests, then relevant integration and required checks at the
  completed-batch boundary. Measure execution and queue time separately before optimizing.
- Extend existing developer entrypoints. Successful commands print compact results; failures name
  the failing check and retain detailed diagnostics on disk. Search/read targeted sections and
  summarize tool output rather than repeatedly loading whole files or successful logs.
- Reuse valid source/input-bound evidence. When a review is requested, send the coherent diff,
  affected interfaces and invariants; recheck fixes locally and request another review only for
  unresolved findings or substantial new changes. Keep updates to decisions, blockers and results.
- Optimize affected scope and remove repeated work before adding concurrency or infrastructure.
  Preserve required checks, data recovery and single mutation ownership.

These working rules supersede heavier review and verification procedures in historical migration plans.

## Tests and pipelines

- Default to small, deterministic unit tests for the changed behavior. Keep business rules, state
  transitions and retry decisions host-testable; extract them from app/platform targets when needed.
  Retain focused database/protocol/process tests only where they prove a distinct boundary.
- Control time: inject clocks, sleepers and async completion points. Advance test time directly;
  do not sleep or repeatedly yield until work probably finishes. Bound waits for real external
  processes, notice early process exit, and clean up children on success, failure and cancellation.
- Fail fast: make failed prerequisites throw/return immediately, preserve command exit codes and
  skip dependent build/package/publish work. Keep diagnostics and cleanup without masking failure.
  Stop obsolete read-only PR work; preserve safe completion of in-flight deployment mutations.
- Keep routine CI free of simulator execution, UI automation, screenshot/video generation and
  image-rendering galleries. Compile affected native targets without booting devices. Platform-only
  validation belongs to an explicitly requested diagnostic, separate from the normal PR path.
- Keep load tests, performance benchmarks, large synthetic histories and repeated timing experiments
  out of CI and hooks. Prove batching/boundary rules with the smallest useful fixtures. Run scale
  experiments locally only when requested; do not replace deleted benchmarks with another pipeline.
- Select checks from actual changed inputs and their consumers. Docs-only changes run cheap docs
  checks; unrelated products, hosts and releases do not run. Unknown ownership fails one cheap check
  naming the path, rather than launching the monorepo. Test-only changes never authorize delivery.
- Reuse successful input-bound evidence and built artifacts; avoid repeated builds, full toolchain
  setup and duplicate assertions across jobs. Keep checks of public behavior; replace tests that
  merely mirror source/YAML structure or renderer details with useful behavioral assertions.
- Aim for 30–90 seconds of affected unit-test execution and a two–five minute ordinary PR path.
  Measure setup, scheduling and execution separately. These are design targets, not a reason to
  hide failures, shorten required work unsafely or claim an unmeasured speedup. Existing required
  checks remain enforced until their replacements are verified and the ruleset is migrated.

For SwiftUI changes consult the vendored SwiftUI expert, Apple HIG, animation and platform glass
guidance. Keep vendored skills unchanged and record upstream updates in `.agents/skills/SOURCES.md`.
Product copy states each point once, with clear actions and concrete destructive consequences.

## Preservation and credentials

Preserve app identities, historical records, SQLite/media, approved host state and independent
service ownership. Read Control Center's local instructions before changing its server/deployment.
Import infrastructure resources before a new state owner can write. Repository privacy is required
before publishing any imported private history. Keep personal health/flight/recording/home data,
plaintext credentials, state and private evidence out of Git.

Use one primary-agent persistent PTY for every `op` call and credential-dependent command.
Disable history/tracing, read only required fields once, keep values in session memory and pass
them directly to the operation. Never inspect/print secret values. Reviewers must not call `op`.
Respect vault locking/expiry. Recovery must remain possible without the homelab runner.

## Completion

Verify the outcome relevant to the request: for example, a processed Apple build, working install or
live service revision and one core interaction. Do not repeat unrelated product acceptance or backup
restores for an ordinary change. Report what ran and any material gaps honestly; do not call a build
a completed deployment. Update existing tracking for the work completed. The five migrated source
repositories were snapshotted into private `github-archive` and deleted by owner request. Preserve historical receipts and active worktrees; do not recreate retired publishers.
