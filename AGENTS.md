# Agent instructions

Read `CODEBASE_OVERVIEW.md` for the map. Production-cutover status and evidence are in
`docs/plans/native-rust-progress.md`; execute `docs/runbooks/native-rust-cutover.md` when cutting over.

## Current migration agreement

Calum approved the native Swift + Rust/SQLite + OpenTofu reset in `docs/plans/native-rust-reset.md`.
The primary agent implements everything. Subagents are allowed only for one independent final review.
Keep implementation, verification, review fixes and commits local until the complete candidate is reviewed.
The main replacement landed in PR #943. Keep follow-up fixes local through verification and final review,
then publish, pass required checks, merge and verify delivery.
Calum chose a Tailscale-only API: all devices on the Tailnet are trusted, with no app login or credential entry.
Production uses the fresh frozen-writer SQLite import; original PostgreSQL and media archives are retained.
Consult issue #941 and the progress tracker for current deployment and Apple-delivery evidence.
Documentation follows working code. Prioritize iPad fidelity, database/Photo Booth preservation and Rust;
exercise iPhone/Duo last. Calum removed Mac app support: ship only iPad and iPhone/Duo.
Keep Mac mini hosting and macOS development/test tooling; retain historical data decoding. Legacy wake images are not a blocker.

## Structure and invariants

- `apple/App` is the production SwiftUI application. Share components and feature providers across sizes;
  preserve the clock-first root, slide-up interaction, bundle IDs and existing iPad design.
- `apple/Packages/PanelKit` owns typed REST clients, wire models and shared client state. Keep this client
  for the cutover; verify it against a real isolated Rust server with `tools/check integration`.
- `server` is one Rust process: Axum HTTP, SQLite persistence and supervised interval work. Feature modules
  own their behavior and SQL; shared integration adapters own external transport. No feature registry,
  queue, generic repository framework or separate worker deployment is needed.
- Preserve existing IDs and data verbatim. Mint new IDs through the server's shared ID primitive.
  Ordered SQL migrations live in `server/migrations`. Never replace an existing database with an empty one.
- SQLite uses WAL: persist its directory, use the backup API or a stopped writer, and check integrity,
  foreign keys, row counts and values. Preserve all Photo Booth media and raw legacy archive data.
- Only one production process owns scheduled work. Device commands have explicit ownership and idempotency;
  avoid automatic mutation retries. Trace structured, sanitized metadata, never credentials or payloads.
- The app connects to `https://homelab.tail8c014d.ts.net` without application credentials. Publish the
  container only on loopback; `deploy/mini/tailscale_serve.py` owns private HTTPS443 and rejects Funnel.
  Preserve unrelated Serve routes. Only release publication retains a server-side automation credential.
- OpenTofu owns retained Cloudflare DNS/Access/tunnel resources. Its enforced encrypted local backend is
  on the mini, outside app storage, operated over SSH with native file locking and NAS recovery copies.
  Import existing resources before enabling automatic applies; protect unrelated services and the tunnel.

## Working and checking

Use `wtp add -b codex/<task> origin/main` before edits; drive worktrees with absolute paths. Never edit the
main checkout, remove a worktree, or delete a branch. `.wtp.yml` runs `tools/setup` and standalone Lefthook.
Commit coherent working slices using Conventional Commits. Keep vendored skills unchanged; record upstream
updates in `.agents/skills/SOURCES.md`.

For SwiftUI changes use `swiftui-expert-skill`, `apple-hig`, `animation-patterns` and the platform's
`swiftui-liquid-glass` skill. Use system glass APIs.

`tools/check` exposes `lint`, `rust`, `ops`, `apple`, `integration` and `infra`. Run relevant checks, then
`tools/test_apple.sh` for the production iPad build/unit tests and iPhone platform policy. Use existing UI tests for interaction evidence.
Pinned linters cover Rust, Python, Swift, shell and workflow files. `tools/check dependencies` enforces
cargo-deny advisories, licenses, dependency constraints and allowed sources. Pre-commit guards formatting/syntax,
private information, encrypted secrets and worktree rules; pre-push runs Rust and operations tests.

## Credentials

Use one primary-agent persistent PTY for every `op` call and credential-dependent command. Disable shell
history/tracing first; read required credentials once and keep them in session memory. Reauthenticate only
when needed. Delegated reviewers must not call `op`. Never print or inspect secret values, including decrypted
vault content; pass required fields directly to the authorized operation. Private snapshots/state stay outside Git.

## Publishing and completion

Interactive requests normally include PR, green required checks, merge and deployment verification; the
migration's local-until-reviewed agreement takes precedence until its final publication gate. Pipeline executors
commit only; their wrapper publishes. Never bypass required checks or merge a red PR.

PRs need Conventional Commit titles and accurate validation. Visual evidence is optional; keep screenshots
and recordings outside Git. Calum explicitly removed the mandatory screenshot requirement. Existing screenshot
archives were removed after the core cutover; production assets and fixtures remain. Avoid private media in shared evidence.
Main merge deliberately deploys the tested immutable revision. Verify backend revision/health/worker ownership,
retained integrations, Apple processing, migrated data/media, fresh NAS backup restore and comparable after metrics.
Keep tracking issues open until their acceptance evidence exists. Report unverified work honestly.
