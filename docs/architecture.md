# Folding architecture and repository design

Status: initial implementation plan; no application modules exist yet. Product behavior remains in [review-spec.md](review-spec.md); build sequence is in [delivery-plan.md](delivery-plan.md).

## Design approach

The owner requested Matt Pocock's [codebase-design skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md) and [improve-codebase-architecture skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md). We read both and used a fresh agent to examine the proposed structure. This is a greenfield application of their principles, not a completed refactoring survey: there is no implementation or change history to audit yet. Run the full survey after the first working tracking flow provides evidence of actual friction.

Use modules with small caller interfaces that encapsulate meaningful behavior. Evaluate a new layer by asking what complexity would return to callers if it disappeared. Test through the same interface callers use. Introduce a replaceable seam when a concrete alternate adapter is needed, rather than wrapping every dependency in a protocol. Keep terminology consistent with the [domain glossary](../GLOSSARY.md), and record durable tradeoffs in `docs/adr/`.

These are engineering principles, not a requirement to use TypeScript, copy a folder template, or impose a large framework on Swift and Rust. Feature folders can grow into modules only when implementation evidence warrants it.

## Repository layout

Create executable directories with their first working code, not empty placeholders. The planned structure is:

```text
README.md
GLOSSARY.md
docs/
  review-spec.md
  delivery-plan.md
  architecture.md
  adr/
apps/ios/
  Folding.xcodeproj/
  Folding/                 # App composition, feature views, navigation, resources
    Features/              # Setup, Today, History, Competition, Settings
    Intents/               # Minimal platform entry points
  FoldingWidgets/          # Widget views and timeline entry points
  Packages/FoldingKit/
    Sources/FoldingDomain/ # Deterministic personal tracking behavior
    Sources/FoldingData/   # Durable recording, read models, sync and upload queue
    Tests/
  FoldingUITests/
backend/
  Cargo.toml
  Cargo.lock
  crates/domain/           # Deterministic competition decisions
  crates/worker/           # Runtime, transactions, routes, jobs and admin HTML
    templates/
    assets/
  migrations/
contracts/
  schemas/
  fixtures/
infra/
  modules/
  environments/staging/
  environments/production/
web/                       # Small public product/support/privacy site
fastlane/
  Fastfile
  metadata/
  fixtures/
  screenshot-templates/
scripts/
.githooks/
.github/workflows/
```

Commit an ordinary shared Xcode project initially; avoid adding a project generator unless repeated maintenance shows a benefit. Pin Swift packages, Cargo dependencies, Fastlane gems, and build-tool dependencies in their native lockfiles. Keep generated builds, screenshots, credentials, and infrastructure state out of source control. Publish release assets separately.

## Swift modules and caller contracts

### FoldingDomain

Own event interpretation, fold/cycle/session semantics, deterministic event ordering, calendar-based summaries, reset-marker ordering, and equivalent-travel calculation. It accepts explicit inputs and returns values; it does not import SwiftUI, Core Data, CloudKit, WidgetKit, or authentication frameworks.

The key behavior is reduction of observed events into counts and session state. Capture ordering in a versioned contract before implementing the reducer. Within a device/generation, allocate the durable source sequence atomically across app/intent writers and preserve it unchanged on retry. Use it for causal order; timestamps assign calendar time and must not reorder retries. Preserve original timestamps, detect clock reversals, and mark unusable intervals uncertain. Out-of-order delivery must reconstruct the same event reduction once the same events are present. Finalized competition snapshots remain governed by their cutoff and accepted-event set; a late earlier event cannot silently rewrite a finalized period. Any historical revision uses the explicit correction path. Legacy/invalid envelopes without required ordering metadata must follow an explicit version policy rather than guessing. This is a proposed implementation default to validate in M1.

### FoldingData

Own the complexity of recording an event durably: transaction, identity/generation validation, deduplication, reducer application, derived read models, and pending upload creation. A caller asks to record an observation and gets a committed receipt or a defined failure; it must not coordinate six storage calls itself.

Keep Core Data managed objects, multi-process serialization, CloudKit reconciliation, migration, persistence-history processing, and queue checkpoints private. Expose compact immutable summaries/session pages to the app and widgets. Export and reset operate through this same interface so all callers use the same rules. Reconcile CloudKit writes through the reducer; imported data must not bypass deduplication/reset handling.

Separate private iCloud synchronization from public competition upload inside the implementation. Local success, iCloud convergence, backend acceptance, reset acknowledgment, and device transfer are distinct states. App-visible pending status must not collapse them into one misleading “synced” flag.

Use actual temporary stores for persistence tests. Only add a fake store adapter if it serves a concrete consumer/test need; do not make a generic repository protocol for every entity. A fixed clock, deterministic network responses, and notification transport are legitimate variation points when used by real fixtures.

### App, intents, and widgets

The app composes dependencies and presents feature views. Intents record through FoldingData and finish within the platform execution budget. Widgets consume snapshots/read models and request appropriate refreshes. Neither intents nor widgets independently implement counters, resets, or CloudKit writes.

Keep foreground hinge animation separate from event accounting. Feature view models are useful where state/async behavior needs an owner; do not require a view model for every trivial SwiftUI view. Use Swift access control and package target dependencies to prevent views from depending on persistence internals.

## Rust modules

### domain crate

Own event eligibility and reduction policy, reset ordering, scoring, ties, percentiles, period/cutoff rules, finalization decisions, and corrections. Accept validated inputs, explicit time, and current state; return decisions/results. No Worker runtime, SQL, HTTP, network, or HTML types in this crate.

Organize by domain concepts within the crate. Do not create a crate per route or formula. Keep internal items private by default and make the public interface small enough to understand without reading database code.

### worker crate

Own HTTP transport, authentication and attestation, D1 transactions, R2 objects, queues, schedules, APNs integration, and admin rendering. Route/job handlers call cohesive operations; they do not each reproduce authentication, reset reconciliation, or result calculations.

D1 transactions/constraints, not in-memory checks alone, enforce uniqueness and race safety. Verify actual provider semantics in integration tests. The interface for accepting a submission must atomically apply eligibility/current generation and persist acceptance plus any required follow-up work. Finalization and notification work must be retry-safe and version-aware.

Admin HTML is a presentation of the same moderation operations used by jobs; it must not bypass them with direct ad hoc database changes. Use concrete integrations initially. A port/trait is justified when a real alternate adapter makes caller-level tests or platform integration possible, not for symmetry with Swift.

## Shared contract, independent trust

Swift and Rust use versioned schemas and the same event/reset/ranking fixtures. They are separate implementations with parity tests, not shared source or a Rust-to-Swift bridge in v1. Client-provided totals and verdicts are never authoritative for competition.

Specify event identifiers, source sequence, device/generation identifiers, observed times, test flags, schema version, maximum batch size, error categories, and retry rules before broad feature implementation. Server receive time is server-owned. Validate actor/device ownership and attestation before invoking the competition domain behavior.

Keep raw personal history in the private store. Send only fields needed for opted-in competition and documented moderation. Store internal moderation evidence separately from user export and public result shapes.

## Tests and architectural enforcement

- Test the recording interface with retries, distinct repeated states, process reopening, concurrent writers, CloudKit ingestion, losing reset generations, and queue recovery.
- Run common deterministic fixtures through Swift and Rust to verify equivalent rules; also test independent acceptance invariants so fixtures do not merely mirror a shared mistake.
- Exercise Worker routes/jobs with realistic storage transaction semantics: duplicate batches, cutoff/finalization races, reset versus ingestion, deletion versus notification delivery, unauthorized requests, and corrections.
- Keep UI tests focused on observable setup/navigation/presentation; screenshots use fixed data/time and the actual view code.
- Compiler target/crate dependencies enforce the major module seams. Add a small import check only if a rule cannot be enforced by access control/manifest structure.
- A PR introducing a module explains what it hides, who calls it, and what alternate adapter justifies a new seam. Remove pass-through layers that provide no useful behavior.
- After M2, run the requested architecture survey on real changed code. Refactor only evidence-backed friction; do not interrupt delivery for speculative cleanup.

## External references

- [Matt Pocock: codebase-design guide](https://github.com/mattpocock/skills/blob/main/docs/engineering/codebase-design.md).
- [Matt Pocock: improve-codebase-architecture guide](https://github.com/mattpocock/skills/blob/main/docs/engineering/improve-codebase-architecture.md).
- The implementation details above are Folding-specific engineering recommendations, not claims that either skill prescribes a Swift/Rust directory structure.
