# Agent instructions

Read `CODEBASE_OVERVIEW.md`, then the product README/local instructions for the area being changed.
Migration acceptance and current evidence live in `docs/plans/monorepo-migration-progress.md`;
read the linked accepted plan before changing delivery, infrastructure or repository ownership.

## Working

Use `wtp add -b codex/<task> origin/main` before edits; use absolute worktree paths.
Keep the main checkout, other worktrees and branches intact. Use Conventional Commits.
Review your own completed changes; delegated reviews, including Astra, require an explicit user request.
Pass required checks before merging. Never bypass a required check.

Progress updates include an estimated overall completion percentage and current stage; distinguish estimates from verified delivery.

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

These working rules supersede heavier review and verification procedures in historical migration plans.

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
a completed deployment. Update existing tracking for the work completed. Archive old sources after consumers and
recovery paths move; repository deletion requires its separate agreed cleanup decision.
