# Contributing

Start with `CODEBASE_OVERVIEW.md`, `AGENTS.md` and the product's local instructions.
[Development](docs/DEVELOPMENT.md) describes the shared lifecycle; product code, components,
fixtures and design stay with their owning app. Control Center's Rust/SQLite rules apply inside
its product; they are not an architecture requirement for every app.

Use a task-named worktree and substantial coherent implementation batches. Run the relevant
checks, fix independent review findings locally and use Conventional Commits. Publish when
ready, pass required checks, merge and verify the actual outcome. Keep private visual evidence
outside Git.

[Release guidance](docs/RELEASE.md) distinguishes product handlers and verification from
publication. Update documentation after the behavior works. Preserve existing identities,
user data, approved host state and active work throughout a move.
