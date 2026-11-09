# Agent instructions

Read `CODEBASE_OVERVIEW.md` for the map. Production-cutover status and evidence are in
`docs/plans/native-rust-progress.md`; execute `docs/runbooks/native-rust-cutover.md` when cutting over.

## Product and preservation

The native Swift + Rust/SQLite + OpenTofu migration is complete. Its accepted delivery, data/media
reconciliation, restore evidence and measurement limits are recorded in `docs/plans/native-rust-progress.md`.
Follow the root working rules: substantial simple changes, proportionate checks and no delegated
reviews unless the user requests them. Documentation follows working code.

Ship the shared faithful iPad/iPhone/Duo app, preserving its clock and slide-up launcher. Mac app support
is removed; Mac mini hosting and macOS developer/test tooling remain. The Tailscale-only API trusts Tailnet
devices without app login or credential entry. Original PostgreSQL/media archives and all Photo Booth files
remain protected. Historical Mac/device data remains decodable; missing legacy wake images are not blockers.

## Structure and invariants

- `apple/App` is the production SwiftUI application. Share components and feature providers across sizes;
  preserve the clock-first root, slide-up interaction, bundle IDs and existing iPad design.
- `apple/Packages/PanelKit` owns typed REST clients, wire models and shared client state. Use
  `tools/check integration` when changing the Swift/Rust wire contract.
- `server` is one Rust process: Axum HTTP, SQLite persistence and supervised interval work. Feature modules
  own their behavior and SQL; shared integration adapters own external transport. No feature registry,
  queue, generic repository framework or separate worker deployment is needed.
- Preserve existing IDs and data verbatim. Mint new IDs through the server's shared ID primitive.
  Ordered SQL migrations live in `server/migrations`. Never replace an existing database with an empty one.
- SQLite uses WAL: persist its directory and use the backup API or a stopped writer. For data migrations
  or storage changes, check integrity and affected data. Preserve all Photo Booth media and raw legacy archives.
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

`tools/check` exposes `lint`, `rust`, `ops`, `apple`, `integration` and `infra`. Run checks for the changed
area. Use `tools/test_apple.sh` for Apple changes and existing UI tests when interaction behavior changes;
do not run Apple builds, UI suites or restore drills for unrelated server, operations or documentation edits.
Pinned linters cover Rust, Python, Swift, shell and workflow files. `tools/check dependencies` enforces
cargo-deny advisories, licenses, dependency constraints and allowed sources. Pre-commit guards formatting/syntax,
private information, encrypted secrets and worktree rules; pre-push runs Rust and operations tests.

## Credentials

Use one primary-agent persistent PTY for every `op` call and credential-dependent command. Disable shell
history/tracing first; read required credentials once and keep them in session memory. Reauthenticate only
when needed. Delegated reviewers must not call `op`. Never print or inspect secret values, including decrypted
vault content; pass required fields directly to the authorized operation. Private snapshots/state stay outside Git.

## Publishing and completion

Follow the user's requested publication scope. When publishing, pass required checks and verify the
affected outcome. Pipeline executors commit only; their wrapper publishes. Never bypass required checks
or merge a red PR. There is no mandatory independent-review or local-until-reviewed gate.

PRs need Conventional Commit titles and accurate validation. Visual evidence is optional; keep screenshots
and recordings outside Git. Calum explicitly removed the mandatory screenshot requirement. Existing screenshot
archives were removed after the core cutover; production assets and fixtures remain. Avoid private media in shared evidence.
Main merge deliberately deploys the tested immutable revision. For a deployed change, check its live
revision/health and one or two affected core flows. Perform Apple processing, data reconciliation, NAS
restore or performance checks only when the task changes or specifically requires them. Reuse existing
valid evidence for unchanged mechanisms. Report material unverified work honestly.
