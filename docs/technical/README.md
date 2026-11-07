# Folding implementation specifications

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
