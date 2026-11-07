# Folding work tracker

GitHub Issues are the live execution tracker. One execution agent; independent reviewers only. Physical-device evidence is deferred to F13 after submission by owner instruction.

Update issue-body checkboxes as individual requirements are verified, with commit/evidence links. Progress comments supplement these checklists. Close fully accepted issues and tick their work-order entries below; partial or deferred work remains unchecked. These rules are enforced as agent instructions in `AGENTS.md`.

## Current batch

Foundation and personal persistence are in progress. Reducer, journal and local private-mirror integration are tested; live cloud, app, backend and release acceptance remain pending.

## Work orders

- [ ] [F00 — Account and build foundation](https://github.com/0x63616c/folding/issues/1)
- [ ] [F01 — Contract freeze and domain fixtures](https://github.com/0x63616c/folding/issues/2)
- [ ] [F02 — Durable journal, private sync, and device experiment](https://github.com/0x63616c/folding/issues/3)
- [ ] [F03 — Rust runtime, security, and D1 transaction experiment](https://github.com/0x63616c/folding/issues/4)
- [ ] [F04 — Personal domain, history, reset, and export](https://github.com/0x63616c/folding/issues/5)
- [ ] [F05 — App shell, setup, and personal screens](https://github.com/0x63616c/folding/issues/6)
- [ ] [F06 — Widgets and daily reminders](https://github.com/0x63616c/folding/issues/7)
- [ ] [F07 — Competition and public account lifecycle](https://github.com/0x63616c/folding/issues/8)
- [ ] [F08 — Admin and avatar/name moderation](https://github.com/0x63616c/folding/issues/9)
- [ ] [F09 — Result notifications and operational jobs](https://github.com/0x63616c/folding/issues/10)
- [ ] [F10 — Localization, tips, assets, and review](https://github.com/0x63616c/folding/issues/11)
- [ ] [F11 — Beta and release rehearsal](https://github.com/0x63616c/folding/issues/12)
- [ ] [F12 — Submit and verify](https://github.com/0x63616c/folding/issues/13)
- [ ] [F13 — Deferred post-submission physical-device validation](https://github.com/0x63616c/folding/issues/14)

## Setup evidence

- Private GitHub repo and 14 task issues across six milestones created.
- Folding 1Password vault created; project connections saved. Secret values stay outside Git.
- Local toolchain observed: Xcode 27.2 (27B52), Swift 6.4.2, Rust 1.99.1, Node 26.13.0, Ruby 3.3.13.
- iOS 27.2 iPhone Duo simulator is installed; build/capture checks pending.
- Cloudflare support forwarding applied through OpenTofu; rule/verified destination and public MX/SPF verified. End-to-end inbox delivery remains pending.

## November 7 foundation evidence

- Owner approved the R2 usage-based subscription; activation confirmed in Cloudflare.
- OpenTofu 1.13.9/provider 5.28.1 created the private `folding-infrastructure-state` bucket (one resource added).
- Bootstrap state is AES-GCM encrypted; recovery document and separate key saved in Folding 1Password.
- Two independent OpenTofu clients tested real R2 conditional locking: the contender was rejected while the first held the lock.
- Encrypted backup restored and decrypted by a third client. Evidence key: `verification/f7ddc17a-8cea-48d4-bc5d-f59ef8618b1c/state.tfstate`; encrypted SHA-256 `3f1c04f6cd45b47a3cdbb48238079d4e51a8e5f360ef60bdc4d742e438d7a5c9`.
- Swift package built locally; six tests passed, including all eleven reducer fixtures in forward/reversed arrival order. This is domain evidence only, not UI/device/persistence evidence.
- Contract validator: six schemas, forty example/rejection checks passed.
- Production email apply created two resources. Encrypted remote backup saved at `backups/production/20261107T163852Z-c1a7d48c-ce7a-4cfa-b4e2-aedfc0e45dfc.tfstate`, SHA-256 `ea873526f1e3e948d6d8a5f7ba9792ef518dae832227f4584038c9986c9c3231`.
- Downloaded bootstrap recovery document from 1Password and compared it byte-for-byte with encrypted local state: passed.
- Still pending in F00: Apple identifiers/signing/API setup, build/release CI, staging resources, backup retention enforcement/CI identities, and end-to-end support inbox test.

## Durable journal batch

- Implemented FoldingData's WAL SQLite journal, migrations, transactional sequence/event/outbox writes, durable setup tests, immutable interruption capture/import and reset handling.
- Added mirror-work leases with ownership tokens. Actual CloudKit transport, persistent-history imports/checkpoints and conflict quarantine remain pending.
- Two independent processes recorded 50 observations with unique contiguous sequences and exactly 50 mirror jobs. Reopening/retries and injected outbox-failure rollback were tested.
- Independent review found public-reset reconciliation, stale interruption retry and restored source identity issues; each was fixed with regression coverage. Retired store handles are also fenced.
- Installation identity uses device-only Keychain plus a non-backed-up sentinel; real entitlements/reinstall/locked-device evidence remains deferred, not passed.
- Added local bootstrap, format/check scripts and Git hooks. Staged formatting was exercised against staged/working-copy differences and a filename containing spaces; neither index nor working files were modified.
- F02 remains open: private CloudKit integration, account partition coordination, import quarantine/checkpoints, crash-kill experiment and physical-device checks are not complete. CI/toolchain pinning, Rust parity and app UI are still pending.

## Private mirror batch

- Added the Core Data/CloudKit private mirror adapter and synchronization coordinator; tests use actual on-disk Core Data stores with cloud connectivity disabled.
- Schema v3 adds atomic history checkpoints, durable future-generation imports, conflict quarantine and rejected-reset tombstones.
- Local integration covers history pagination/reopen, duplicate saves, save-before-ack replay, reset convergence, checkpoint-write rollback, replacement mirrors and two-journal conflict convergence.
- Independent review found read-error handling, conflict propagation, reset cursor poisoning and unbounded history fetching issues; fixes include bounded fetching and regression coverage.
- Twenty-eight Swift tests, contract checks and formatting passed. No claim of live CloudKit sync, account switching or device validation.
- Remaining F02 work includes account-partition lifecycle, expired-token recovery, old-mirror cleanup, transfer integration, real crash-kill evidence, Apple capability/schema setup and physical checks.
- Agent instructions now require updating issue-body checklists as each item is verified, plus closing fully accepted issues and updating this tracker. Verified progress has been checked in issues #1–#3.

## Private-history recovery batch

- First attachment and expired Core Data history tokens recover retained records through a pinned, paginated snapshot. Concurrent writes replay from the captured boundary; failed imports/checkpoint writes restart safely.
- Schema v4 indexes deferred generations and bounds their import/migration batches; unrelated future records are not repeatedly decoded.
- Independent review identified first-attachment data loss after history pruning and unbounded deferred decoding. Both were fixed with regression tests; focused follow-up found no new blocker.
- `scripts/check` passed 34 Swift tests (6 domain, 28 data), six schemas/forty contract checks and formatting. Tests include real Core Data history pruning, writes during snapshot pagination, injected failures, 1,100 deferred records and v3 queue migration.
- Account partition/fencing, mirror cleanup/transfer integration, live CloudKit setup and deferred physical checks remain outstanding. This batch verifies local recovery only.

## Account-partition boundary batch

- Added a durable shared/exclusive file-lock fence around every routed journal transaction; suspension invalidates old readers/writers, including an already-open journal in another OS process.
- Added app-owned private partition lifecycle, separate hashed account directories, same-account reuse, safe transition supersession and shutdown/recheck around async mirror loading.
- Returning to a partition preserves its history, invalidates a spanning tracking session and clears stale public enrollment/work/setup leases. Ordinary same-account launch retains valid session continuity.
- Independent review identified restored routing authority on a new installation. Route/lease identity binding and a restoration regression fixed it; focused recheck found no remaining blocker.
- `scripts/check` passed 40 Swift tests (6 domain, 34 data), six schemas/forty contract checks and formatting.
- Still pending: real CloudKit account lookup/notification wiring, app/widget/export cache invalidation, signed capability validation and live account-change evidence. Local tests explicitly disable cloud transport.
