# Native + Rust reset — execution tracker

Approved 2026-11-07. Source plan: [native-rust-reset.md](native-rust-reset.md).
All code remains local until implementation, verification and one independent final review are complete.
Final independent review is complete and both findings are fixed. Final publication is beginning;
production deployment and real OpenTofu ownership import/apply remain outstanding.

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

- Rust: strict Clippy/format checks and 23 tests pass (3 unit, 20 HTTP/integration, including the delayed-alarm regression).
- Python: 49 tests pass (30 operations, 19 migration/CI/provisioning), including synthetic credential handling.
- Swift package: all 101 tests pass.
- Actual isolated Swift-to-Rust read/mutation/auth and Photo Booth upload/list/download bytes pass.
- OpenTofu: fmt/validate and both mocked route tests pass. Isolated backend proof passes encryption,
  competing-writer lock rejection, wrong-key rejection and encrypted backup restore.
- Rust/Python/Swift/shell/workflow lint checks pass. Final independent source review found an alarm occurrence
  identity bug and device walk provenance bug; both are fixed. The reviewer inspected the alarm fix; actual
  Swift-to-Rust requests now verify all three device source values.
- Production iPad target compiles. The full 258-test run passed 256 tests; the two grid assertions were fixed
  and all eight layout tests passed on rerun. Both selected iPad UI tests passed (clock/launcher and live feature
  navigation). Duo clock/launcher UI test passed. Mac Catalyst builds, including the device-provenance fix.
  Physical-device connectivity/background behavior and broader interaction acceptance remain outstanding.
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


## Authentication decision reopened — 2026-11-07

Calum rejected manual per-device connection-record entry and requested alternative setup flows.
PR #943 is open with auto-merge DISABLED pending agreement on the replacement. The original Bun/PostgreSQL
app was restarted and verified healthy. The final frozen snapshot/import/NAS backup and infrastructure
restore proof succeeded, but PostgreSQL writes have resumed: the staged SQLite candidate is now a rehearsal,
and its production acceptance marker was moved out of the app directory. A fresh stopped-writer snapshot
and reconciliation are mandatory before any later Rust deployment. Do not restore the old acceptance marker.
Cloudflare adoption/API provisioning completed; old app access and its existing device token remain working.
Private recovery/enrollment material is retained in the world-wide-webb 1Password vault.
Screenshot archives and the mandatory PR-screenshot rule are to be removed after the core cutover, per Calum.


## Tailscale-only access approved and implemented locally

Calum chose all Tailnet devices as the trust boundary. Manual enrollment, Keychain connection records,
Cloudflare client credentials and the general API bearer token are removed. The shared app defaults to
private Tailscale HTTPS; release publication keeps a server-side automation token. Host release/recovery
code declares private HTTPS443, rejects Funnel/conflicting routes and preserves other services. Container
preflight rejects non-loopback publication. Cloudflare HCL now retains only the four independent services.

Current local checks: 23 Rust tests and strict Clippy, 51 Python tests, 99 Swift package tests, all 256
production iPad unit tests, the actual credential-free Swift/Rust Photo Booth round trip, Mac Catalyst build,
and both OpenTofu route tests plus encryption/locking/recovery proof pass. The private HTTPS route is
installed and reachable from the Mac; existing production remains healthy on Bun/PostgreSQL. The public
Cloudflare retirements are not yet applied. Final source review of this user-directed change is in progress.

The fresh frozen-writer migration remains mandatory because original PostgreSQL writes resumed. Keep the
old import marker invalidated and its candidate outside production. PR #943 is a draft with auto-merge off;
finish the Tailscale review and update the complete candidate before resuming publication/cutover.
