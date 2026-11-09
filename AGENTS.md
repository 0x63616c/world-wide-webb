# Agent instructions

Read `CODEBASE_OVERVIEW.md`, then the product README/local instructions for the area being changed.
Migration acceptance and current evidence live in `docs/plans/monorepo-migration-progress.md`;
read the linked accepted plan before changing delivery, infrastructure or repository ownership.

## Working

Use `wtp add -b codex/<task> origin/main` before edits; use absolute worktree paths.
Keep the main checkout, other worktrees and branches intact. The primary agent implements;
subagents are allowed for independent final review only. Keep the complete relevant candidate,
checks, fixes and Conventional Commits local until final review, then publish, pass required
checks, merge and verify delivery. Never bypass a required check.

Progress updates include an estimated overall completion percentage and current stage; distinguish estimates from verified delivery.

Prefer substantial working batches, existing product handlers and relevant checks. Reuse valid
exact-source artifacts/evidence. Products own their UI/components, architecture, fixtures and
listing facts. Shared tooling owns process and selection; an unrelated app change must not ship
other products, apply infrastructure or activate hosts. Bun is the JavaScript tooling default;
retain runtimes required by actual product tools.

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

Prove the actual outcome: processed Apple build/group membership, signed/notarized private install,
exact live service/host revision, retained data and restore evidence as applicable. Upload/build
success alone is insufficient. Distinguish verified evidence from provider/device/account deferrals.
Keep tracking work open until acceptance exists. Archive old sources only after consumers and
recovery paths move; repository deletion requires its separate agreed cleanup decision.
