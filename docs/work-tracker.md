# Folding work tracker

GitHub Issues are the live execution tracker. One execution agent; independent reviewers only. Physical-device evidence is deferred to F13 after submission by owner instruction.

## Current batch

Foundation/account setup is in progress. The initial Swift reducer is implemented and tested; full feature acceptance remains pending.

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
