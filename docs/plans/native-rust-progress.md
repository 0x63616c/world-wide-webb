# Native + Rust reset — local execution tracker

Approved 2026-11-07. Source plan: [native-rust-reset.md](native-rust-reset.md).
Everything stays local until the full candidate is implemented, tested and independently reviewed.
No remote project/issues, PR, push, deploy or OpenTofu apply has been performed.

## Packages

1. **Foundation and preservation — in progress.** Precautionary backup verified on NAS;
   isolated restore/import rehearsal and initial workload baseline completed. Final frozen-writer import and after measurements remain.
2. **Complete replacement — in progress.** Primary agent owns all implementation; agents are reserved for final review.
3. **Delivery and cutover — not started.** Local CI redesign follows complete layout; hosted checks and
   production cutover occur only at final publication.
4. **Cleanup and evidence — in progress.** Web/Expo/TypeScript backend and Pulumi code removed locally; Swift moved to apple/. Rust container/release/recovery and standalone hooks are implemented. Docs and final evidence remain.

## Ownership

- Primary: all implementation, integration, verification and local commits.
- Implementation agents stopped at user request; only independent final review may use an agent.

## Preservation evidence

Backup 20261107T202453Z: 14 payloads, 475,622,543 bytes, NAS read-back verified.
Manifest SHA-256: 4134ae935bc22a5cf3090fd0067ec1d8787ed775a3a1aecc90e3844fc42528a1.
Isolated PostgreSQL restore and SQLite import completed with row/value reconciliation and integrity checks. Original production data is untouched.
All 135 Photo Booth references resolve to restored files. On 2026-11-07 Calum clarified that Photo Booth is the photo preservation requirement; missing legacy wake photos are not a migration blocker. Existing backup copies remain intact.
Live sample: DB 371,889,855 bytes; media 171,712 KiB / 1,705 files; 135 booth records,
1,621 wake-photo records, 11 walks. See plan for measurement caveats.

## Execution order

Finish backend, transport/auth, deployment tooling, repository cleanup and CI first.
Full iPad/iPhone/Duo/Mac layout and interaction testing is the last local verification step,
followed by independent final review, fixes and publication. Compile checks continue during implementation.

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

## User priority clarification — 2026-11-07

Complete the working faithful iPad app against Rust, verified database and Photo Booth migration,
and removal of the old stack first. iPhone/Duo and Mac remain important and in scope, but their
remaining adaptation and full interaction testing come last, after the core migration and cleanup.
Do not delay core implementation for phone or Mac polish. Final review and publication follow.

Latest local evidence: production iPad target builds after relocation; Swift REST round trip against an isolated Rust process passes. Rust 21 tests plus strict Clippy pass; backup/release operations 30 tests and migration tooling 11 tests pass. The older Swift wire fixtures/assertions are partly migrated and the full Swift suite is not yet green. No push or live cutover.
