# Folding implementation specifications


## Owner-approved execution update — November 7, 2026

The owner has authorized implementation through submission/publication and reports Apple account agreements/tax/banking requirements complete. Verify actual App Store Connect state when used; do not request these again unless a concrete account prompt contradicts that report.

Physical-device testing is explicitly deferred until **after App Store submission**. Any earlier wording requiring a real-device pass before feature work/submission is superseded by this scheduling exception. Keep these checks marked **deferred**, never passed; continue simulator, domain, backend, security, UI, and release checks before submission. Do not bypass App Attest or fabricate device evidence to satisfy this schedule. Missing device-only evidence is recorded in the release manifest as an owner-approved deferral, not a successful check. Automatic release after approval remains enabled; approval may occur before device testing is complete.

Immediately after verified submission, run the deferred Duo tests with the owner and fix/resubmit if needed. The full shipping goal remains incomplete until required deferred tests and resulting fixes are resolved. Known functional/security failures are still fixed promptly; this exception defers hardware evidence, not already-known defects.

These documents turn the product plan into implementation contracts. They choose defaults for agents; they do not claim that device experiments or integrations have passed.

Read in order:

1. [Product specification](../review-spec.md): intended user behavior.
2. [Storage and tracking](storage-and-tracking.md): types, local transactions, iCloud replication, counting, reset, and setup tests.
3. [Backend and security](backend-and-security.md): HTTP operations, authorization, D1 operations, competition and moderation.
4. [UI](ui.md): view/state ownership, exact screens, setup, widgets, accessibility, and localization.
5. [Release and operations](release-and-operations.md): pinned tooling, infrastructure, CI, screenshot and release flow.
6. [Agent work orders](work-orders.md): dependency order, file ownership, acceptance evidence, and prohibited shortcuts.
7. [Review record](review.md): independent review findings and resolutions.

Machine-readable contracts are in [contracts/](../../contracts/README.md). They define shapes and deterministic examples, not proof that an implementation is correct.

## Execution cadence

One execution agent builds substantial feature batches; no execution subagents. Independent agents are used only for review. Follow the [delivery plan](../delivery-plan.md#delivery-rules): foundation proof, focused validation at feature-batch completion, then full integrated release validation. Work-order acceptance checks remain required but do not trigger a stop after every small edit.

## Authority and change control

The product specification controls user-visible behavior. These technical specifications control implementation defaults and supersede earlier *implementation recommendations* in architecture/delivery notes where explicitly recorded in an ADR. If they conflict on product behavior, fix the inconsistency before implementation; do not silently pick a different interpretation. Contracts and their examples must agree with both.

An agent may choose private names and helper functions. It must not independently change public schemas, count definitions, retention, eligibility, privacy behavior, production trust, or the release gate. Propose those changes as a small contract/ADR change first. A reviewer can approve routine engineering corrections; owner input is needed only for a material product tradeoff or external account/legal fact.

## Fixed defaults

- SwiftUI and Observation for app presentation; Swift concurrency with explicit UI isolation; Foundation value types in the domain target.
- System SQLite3 for the canonical App Group journal; `NSPersistentCloudKitContainer` for a private immutable-record replication mirror. See [ADR 0002](../adr/0002-atomic-tracking-storage.md).
- Rust `domain` and `worker` crates only initially. workers-rs, Serde, D1 SQL, private R2 objects, Queues/scheduled work. Rust-rendered escaped HTML for admin.
- Versioned JSON HTTP contracts. No GraphQL, generic repository framework, cross-language FFI, analytics SDK, or SPA in v1.
- OpenTofu for infrastructure, Fastlane for Apple delivery, GitHub Actions for CI; versions pinned only after the toolchain spike confirms compatibility.
- Tests at module interfaces and real integration seams; fixtures never authorize production scores.

## Unproven mechanisms with mandatory experiments

These are bounded tasks with outputs, not invitations to guess: exact Shortcuts trigger/handoff behavior; App Intent execution while locked; background attested upload; multi-process journal contention/data protection; private CloudKit mirror convergence; Worker crypto/APNs/image-decoder compatibility; Xcode/runner screenshot device support. Each has a named work order and a pass/fail gate. Failure requires a documented alternative and re-test before dependent work proceeds.
