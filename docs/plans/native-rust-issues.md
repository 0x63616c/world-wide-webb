# GitHub tracking drafts — publish only at the final publication step

Project: **Native + Rust reset**. Status fields: Todo / In progress / Review / Done.
Fields: work package, dependency, acceptance evidence. Repository: 0x63616c/world-wide-webb.
Keep one umbrella issue and four large work issues; these are not separate PRs.

## Umbrella: Native Swift + Rust/SQLite/OpenTofu reset

Deliver the approved native-rust-reset.md plan. One shared clock-first Swift experience, retained
features, Rust backend, SQLite with lossless migration, OpenTofu and automated delivery. Preserve
all user data/photos and Git history. Complete locally and independently review before publishing.
Link all four package issues and the approved plan at publication. Close only after deployment evidence.

## 1. Foundation and preservation

Verify fresh backup and isolated restore; capture comparable CPU/memory/storage baseline. Inventory
all schema/media; establish target layout, Rust tools, Swift transport contract, auth and state backend.
Acceptance: recovery demonstrated; all source records have explicit disposition; foundational contracts
proven with real read/mutation/streaming; no destructive production work. Dependency: none.

## 2. Complete replacement

Implement retained Rust feature behavior, SQLite importer and shared Swift iPad/iPhone/Duo/macOS app.
Preserve clock/design, local settings, bundle identity and offline behavior. Add meaningful tests.
Acceptance: all retained scenarios pass, production targets build, importer reconciles data/media against
restored backup. No mock/no-op endpoint substitutes. Dependency: foundation.

## 3. Delivery and cutover

Finish local CI/required-check transition, OpenTofu, API hostname, signing and cutover automation.
After full local review/publication and green checks, freeze old writes, final backup/import, validate and
switch. Acceptance: deployed immutable revision, functioning clients, no duplicate workers, complete
reconciliation and rollback evidence. Dependency: replacement and local cleanup/review.

## 4. Cleanup and evidence

Remove web/Expo/Bun/Pulumi/obsolete features and exclusive dependencies from active code, preserve
archival data, update overview/AGENTS/runbooks, verify new backups and before/after measurements.
Acceptance: clean checkout builds new stack, independent review resolved, visual evidence and deployed
behavior verified. Code cleanup precedes final push; measured post-cutover evidence follows deployment.
