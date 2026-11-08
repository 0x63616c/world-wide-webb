# Build 4 — focused feedback patch

Version 1.0.0 (4), September 10, 2026.

- Add weight, dose and check-in entries from the Journal toolbar.
- Open a journal row using its full row area; omit note previews from the list.
- Delete from weight, dose and check-in editors with a confirmation. Use a red swipe action and centered confirmation in Journal.
- Use the saved weight unit rather than asking again during entry.
- Center the dose number and make Add a vial a recognizable button. Initialize dose drafts only once when presenting an editor.
- Label the middle appetite/nausea rating and improve note spacing.
- Right-align Home weekly change, put Progress metric units beside values, leave chart edge padding, and keep vial concentration on one line.

The journal file format and medication calculations are unchanged. Medication naming/history identity, the Plans control, onboarding, widgets and larger redesign work remain outside this small release. Do not interpret this patch as resolving all screenshot feedback.

Validation: regression at the existing UI boundary for Journal add/edit/delete/cancel/relaunch (observed failing before implementation); dose unit/status round-trip coverage; existing core and UI suite. See RELEASE.md for final distribution state.

Verified: 12 core tests and 8 UI tests passed with no failures. UI result: `Test-Still-2026.09.10_11-59-42--0700.xcresult` on Tend QA Pro Max (iOS 26.2). Physical iOS 27 behavior is not covered by that simulator run.

Synthetic-data screenshots: [Journal](screenshots/build4-journal.png), [Dose entry](screenshots/build4-dose.png).
