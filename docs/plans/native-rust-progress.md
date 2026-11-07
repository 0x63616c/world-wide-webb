# Native + Rust reset — local execution tracker

Approved 2026-11-07. Source plan: [native-rust-reset.md](native-rust-reset.md).
Everything stays local until the full candidate is implemented, tested and independently reviewed.
No remote project/issues, PR, push, deploy or OpenTofu apply has been performed.

## Packages

1. **Foundation and preservation — in progress.** Precautionary backup verified on NAS;
   isolated restore/import rehearsal and full workload baseline still required. Plan and instructions committed.
2. **Complete replacement — in progress.** Parallel Swift, Rust and infrastructure owners below.
3. **Delivery and cutover — not started.** Local CI redesign follows complete layout; hosted checks and
   production cutover occur only at final publication.
4. **Cleanup and evidence — not started.** No old implementation removed until replacement coverage proven.

## Ownership

- Primary: instructions, local tracking, data import/reconciliation, CI and integration/final review.
- rust_server: server/, Cargo.toml, Cargo.lock, rust-toolchain.toml.
- apple_native: apps/apple-prototype/ and eventual apple/.
- infra_ops: infra/cloudflare/, deploy/mini/, tools/backup*, tools/cutover*.

## Preservation evidence

Backup 20261107T202453Z: 14 payloads, 475,622,543 bytes, NAS read-back verified.
Manifest SHA-256: 4134ae935bc22a5cf3090fd0067ec1d8787ed775a3a1aecc90e3844fc42528a1.
This is transfer verification, not a restore rehearsal. Original production data is untouched.
Live sample: DB 371,889,855 bytes; media 171,712 KiB / 1,705 files; 135 booth records,
1,621 wake-photo records, 11 walks. See plan for measurement caveats.

## Final gate (all required)

- [ ] Every retained feature parity scenario implemented and passing
- [ ] SQLite import, content reconciliation and backup restore demonstrated
- [ ] Native iPad/iPhone/Duo/macOS production targets built and exercised
- [ ] Platform auth/enrollment/background behavior verified
- [ ] OpenTofu and operations validated without changing live infrastructure
- [ ] Old stack removed, docs/linters/hooks/CI match new layout
- [ ] Independent final review findings resolved
- [ ] Publish local tracking and candidate, required CI green, coordinated cutover
- [ ] Verify deployed app, Apple processing, after measurements and new backup restore
