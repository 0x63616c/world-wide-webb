# Native + Rust reset — execution tracker

Approved 2026-11-07. Source plan: [native-rust-reset.md](native-rust-reset.md).
All code remains local until implementation, verification and one independent final review are complete.
No push, PR, GitHub project/issues, production deployment or real OpenTofu apply has occurred.

## Implemented locally

- Removed web/Expo/TypeScript workspaces and Pulumi code; Git history retained. Production Swift moved to
  `apple/`, Rust to `server/`, OpenTofu to `infra/cloudflare`, with native-only container and delivery tooling.
- Retained typed Swift client now calls versioned Rust REST routes, with no bundled device credentials.
  Private enrollment verifies connection and stores the complete record in Keychain. Redirects are rejected.
- Rust implements retained feature APIs and scheduled behavior, SQLite persistence, HA adapters, alarms,
  physical switch continuity, desired/reported light ownership, Sonos, Tesla, weather and Photo Booth.
- Consistent SQLite snapshots, guarded immutable releases/recovery, raw archive/import/reconciliation,
  NAS backup adaptation, encrypted/locked infrastructure state and tested-main delivery are implemented.
- Pinned Rust/Python/Swift/shell/workflow linting and standalone hooks replace JavaScript tool dependencies.
  CI selects relevant native/image/infra jobs and aggregates required results fail-closed.

## Verification recorded

- Rust: strict Clippy/format checks and 22 tests pass (3 unit, 19 HTTP/integration).
- Python: 49 tests pass (30 operations, 19 migration/CI/provisioning), including synthetic credential handling.
- Swift package: all 101 tests pass.
- Actual isolated Swift-to-Rust read/mutation/auth and Photo Booth upload/list/download bytes pass.
- OpenTofu: fmt/validate and both mocked route tests pass. Isolated backend proof passes encryption,
  competing-writer lock rejection, wrong-key rejection and encrypted backup restore.
- Rust/Python/shell/workflow lint checks pass. Swift formatting is applied; final full check follows fixes.
- Production iPad target compiles. Native unit tests are being converted from obsolete wire assertions and
  fixture locations; final suite is not yet green. Full interaction/device checks remain outstanding.
- Local Docker is unavailable. The required hosted image job must prove actual container runtime/persistence
  before release. Production state import and real device enrollment are not certified by isolated tests.

## Preservation evidence

Precautionary backup `20261107T202453Z`: 14 payloads, 475,622,543 bytes, NAS read-back verified.
Manifest SHA-256: `4134ae935bc22a5cf3090fd0067ec1d8787ed775a3a1aecc90e3844fc42528a1`.
Isolated PostgreSQL restore and SQLite import completed with schema/type/row/value reconciliation,
foreign-key and integrity checks. Original production data is untouched.
All 135 Photo Booth references resolve to restored files. Calum accepts missing historical wake images;
51 already absent in the source are not a blocker. Full backup copies and raw archived records are retained.

Baseline: PostgreSQL logical size 371,889,855 bytes; directory 809,336 KiB. Media 171,712 KiB / 1,705 files.
Bun RSS 69.78–71.81 MiB, mean CPU 3.87%; app PostgreSQL RSS 130.8–140.1 MiB, mean CPU 1.85%;
tunnel RSS 25.75–33.64 MiB, mean CPU 0.405%. Rehearsal SQLite 370,569,216 bytes. These are different
storage measures, not a claimed saving. Comparable post-deployment samples and fresh restore remain required.

Private evidence lives outside Git under the primary operator's migration archive. Never publish raw
source rows, media filenames, enrollment records, credentials or decrypted infrastructure state.

## Finish in this order

1. Resolve actual native test failures, finish iPad interactions/evidence, then iPhone/Duo and Mac checks.
2. Complete one independent final review, fix findings and commit the complete local candidate.
3. Publish the drafted project/issues and one PR; satisfy required CI at the current head without bypass.
4. Execute [the cutover runbook](../runbooks/native-rust-cutover.md): final frozen-writer backup/export/import,
   data/media reconciliation, private provisioning, OpenTofu ownership import, coordinated tested deployment.
5. Verify actual iPad connectivity/background alarms and retained features, revoke old bundled credentials,
   retire the app hostname, verify Apple processing, compare after metrics and restore a fresh NAS backup.
6. Record evidence and close tracking issues only when their acceptance criteria are met.

The primary agent owns implementation and credential operations; only the final reviewer is delegated.
User priority: faithful working iPad, preserved database/Photo Booth, Rust and removal of the old stack.
iPhone/Duo and Mac remain in scope and are checked last. Do not wait on hosted CI during local coding.
