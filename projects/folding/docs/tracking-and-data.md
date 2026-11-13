# Tracking and data

> Historical planning notes. The consolidated [v1 review specification](review-spec.md) supersedes proposals and unresolved choices below. Retained for rationale and traceability.

## Counting contract

**Agreed intent:** an opening movement and a closing movement each count as a fold; folding need not mean opening completely flat. Track the underlying kinds of activity separately where possible.

**Unverified implementation boundary:** Shortcuts open/close triggers may report threshold crossings rather than every change in movement direction. Do not promise continuous motion tracking from discrete triggers.

Examples to resolve on a physical device:

- Closed → partially open → closed: desired outcome is two folds, if both system events fire.
- Partially open → slightly farther open → partially open: may yield no system events.
- Closed → fully flat → closed: two open/close folds, potentially one fully-open event and one completed cycle.

**Proposed:** count deduplicated observed open and close events; derive cycles from paired transitions, not total divided by two. Define minimum movement, jitter handling, and foreground/background event reconciliation after testing.

Apple documentation consulted describes live hinge angle/state APIs for app interaction. It does not establish that Folding can continuously observe hinge movement while suspended. No Shortcuts continuous-angle action or exact trigger threshold was verified.

## Time unfolded

**Agreed:** elapsed physical unfolded time, including overnight, rather than active screen time.

**Proposed:** derive sessions from paired events; split durations across reporting days. Represent missing or contradictory events explicitly instead of inventing precise durations. Define current-session display, reboot handling, daylight-saving changes, travel between timezones, and incomplete sessions before implementation.

## Hinge travel

Desired outputs include cumulative angular travel, equivalent cycles, and a playful distance equivalent.

- Measured angular travel requires enough angle observations to reconstruct movement.
- A terminal angle reading alone cannot establish the preceding path.
- Event-based travel requires an explicit assumption and an “estimated” label.
- Distance must identify its geometric meaning, such as an illustrative point moving around the hinge; it is not movement of the hinge through space.

Decide whether v1 includes estimates, foreground-only measurements, or defers this feature after the device experiment.

## Storage and sync

**Agreed:** personal history syncs with iCloud; competition is optional.

**Proposed architecture:** local-first event storage with private CloudKit-backed synchronization. The exact persistence framework is undecided. Keep personal raw history private; define the minimal event data required by the competition service separately.

Required design cases: offline logging, repeated deliveries, app/intent/widget shared storage, foreground and Shortcut duplicate detection, out-of-order sync, reinstall, multiple devices, and interrupted writes. Device versus account-wide aggregation remains a product decision.

## Reset and export

**Agreed:** reset clears personal history and public scores. Data export is available.

**Proposed reset behavior:**

- Explain scope and confirm the destructive action.
- Clear synchronized personal history and remove public competition scores.
- Use a new tracking generation so stale devices and queued uploads cannot restore deleted history.
- Show cloud work as pending when offline; do not falsely report remote completion.
- Preserve appearance preferences unless a separate full-reset option is selected.
- Preserve independently justified moderation restrictions so reset cannot evade a ban.

Whether reset also deletes historical placements and medals, leaves competition, and clears thresholds/preferences is still open. Account deletion is a separate flow to specify.

**Proposed export:** CSV for analysis plus JSON for a complete portable record, including schema version, timezone, event provenance, and estimate/uncertainty markers. Import is not yet in scope. Format and retention duration need agreement.

## Physical-device feasibility checklist

The owner has an iPhone Duo. Installed iOS version is still unknown.

- Inspect the actual available automation triggers, action inputs, and run options.
- Test full and partial openings/closings; record triggering thresholds and repeated-event behavior.
- Test locked, unlocked, other-app, suspended, force-quit, rebooted, and offline conditions.
- Check whether App Intents can read hinge state when invoked and where they execute.
- Verify how to open Shortcuts and which setup steps can be preconfigured.
- Verify whether automation installation/enabled state can be inspected at all.
- Test receiving events during onboarding without double counting test activity.
- Test notification delivery and widget update behavior after events.
- Establish battery/runtime constraints and realistic tracking reliability.

These are investigation tasks, not completed tests. No implementation should claim these capabilities until verified.
