# Technical specification review record

Date: November 7, 2026. Scope: specification consistency and implementability before application development.

An independent agent, given a fresh context and the repository documents, reviewed the technical specifications and contract examples. It did not author the files. The UI and release specifications were authored in separate scoped workstreams, then integrated by the coordinator.

## Findings and resolutions

1. **Initial generation could discard one offline installation's history.** Separated account namespace from reset identity; fixed revision-zero reset ID to the all-zero UUID. Only explicit resets erase history. Added initial-sync lifecycle fixture.
2. **Interruption records were not represented in private replication.** Added immutable interruption schema, mirrored entity, atomic mirror outbox work, and replay fixtures. Interruptions invalidate session continuity while preserving the last transition for fold deduplication, keeping personal/public physical fold interpretation aligned.
3. **Private transfer had no implementable cutoff.** Defined logical transfer ordering and captured source-sequence watermarks, including late old-source observations, concurrent choices, bootstrap behavior, and export visibility. Updated the product specification and added a lifecycle fixture.
4. **Finalization could inherit post-cutoff changes from live counts.** Defined frozen observation inputs, independent replay, staged participant completion, and atomic result publication. Added late-intervening-event and approval/revocation fixtures. Production scale and D1 semantics still require integration evidence.
5. **Deletion polling credentials and recovery were absent from DTOs.** Defined DeletionReceipt, a scoped authorization header, explicit same-subject recovery, reauthentication purposes, and a 30-day recovery mapping retention rule. Added lost-response acceptance scenario and product privacy wording.
6. **Export layout/retention was underspecified.** Defined JSON fields, CSV ZIP files/columns, snapshot/reset interaction, test/excluded-source visibility, temporary file protection, and cleanup after sharing/crash.
7. **Sign-in challenge/exchange purpose names disagreed.** Standardized to `sign_in` and added matching/mismatching purpose scenarios.
8. **Mirror work omitted new control records.** Added interruption/transfer kinds and atomic marker/outbox insertion; transfer policy survives reset cleanup. Added crash-recovery scenario.
9. **Stale interruption wording in the final pass.** Replaced the old unknown-state phrasing with session invalidation that preserves the last observed transition.

## Outcome and limits

The independent reviewer reported no remaining P1/P2 blockers in its bounded re-review after the last wording correction. This is approval of specification consistency, not proof that the app, CloudKit synchronization, attestation, D1 transactions, APNs, or screenshots work. Those gates remain assigned in [work-orders.md](work-orders.md).

The local contract validator passes six schema definitions and 40 schema/example checks. All fixture JSON parses. The fixture expected outcomes are specifications; Swift/Rust reducers do not exist yet and have not been tested against them. Local Markdown links and whitespace are checked before committing.

## Selected implementation refinements to notice

- Canonical SQLite3 journal plus private Core Data/CloudKit replication, recorded in ADR 0002.
- OpenTofu chosen for infrastructure; actual provider/state-lock compatibility remains a bounded experiment.
- A private transfer retains inactive-source history only through captured known sequence watermarks in the main summary; all observations remain available in device detail/export until reset.
- CSV export is a ZIP of three documented CSV files, rather than an ambiguous flattened file.
- Deletion-status recovery retains only a minimal keyed mapping for 30 days, separate from moderation retention.

Future agents must not call these experiments completed because this review passed. Keep implementation evidence alongside each work order.
