# Core user journeys

Tend is a local treatment journal. Every screen should serve one of these journeys.

## 1. Get started
Open an empty app without an account. Set medication, optionally add a vial (received date, mg/mL, mL), choose dose weekdays, and optionally enable reminders. Time and a realistic notification preview appear only after reminders are enabled. Syringe units require an explicitly confirmed U-100 scale. Nothing guesses a prescribed dose.

## 2. Log the scheduled dose
Tap Log on the dashboard. Enter an amount in the preferred unit; see its mg equivalent for volume/units. The actual time defaults to now. Save remains visible above the keyboard. Saving updates the journal, medication estimate, vial estimate, and intended schedule occurrence atomically. A future actual date becomes a plan.

## 3. Resolve an overdue dose
The dashboard shows the oldest unresolved occurrence and its date. Log the actual time or select Skipped. Skipping needs no amount. Both resolve that occurrence without moving the next one. Planned records never count as taken. Taken ticks use the accent colour; skipped uses a minus symbol.

## 4. Log weight
Tap the weight-card plus. Enter a plain decimal in pounds or kilograms, optionally change the date or add a note. Invalid/impossible input cannot save. Unit switching converts the number. Historical edits update trends. Future records stay out of actual analytics.

## 5. Understand trends
Tap either dashboard graph for details and scrub individual dates. Medication history is a dose-decay estimate; future projection is dashed and only includes explicit plans when requested. Weight graphs support date ranges, net change, average rate, and an optional goal/date with a clearly labeled trend projection. No automatic calorie prescription.

## 6. Check in
Choose appetite and/or nausea using five circles. Appetite endpoints: 1 not hungry, 5 very hungry. Nausea endpoints: 1 none, 5 severe. Nothing preselected; either is optional. Add a date/note, save, then inspect/edit the record or view trends. These are personal ratings, not diagnoses.

## 7. Start a new vial
Add a new vial from Treatment. Preserve prior vial records and dose concentration snapshots. Estimated volume remaining subtracts only taken doses linked to that vial. Plans/skips do not consume it. Editing a dose recalculates balance.

## 8. Correct history
Open the journal, filter and select a record, edit and save. Confirm deletion before removing a record. Never silently lose data on a read/write error. No synthetic data is written into a real journal.

## 9. Tune preferences
Set kg/lb and System/Light/Dark. Modify reminders without being forced through irrelevant fields. Privacy and model explanations live behind dedicated links rather than filling daily screens.

## Scope discipline
AI stays a clearly marked coming-soon preview. No live chat, calorie prescriptions, subscriptions, account flow, social feed, streak rewards, or implied clinical advice. Launch marketing is a documented plan, not extra app UI.

## Acceptance walkthrough
Run each journey with empty and synthetic data where relevant, including relaunch persistence, historical/future records, invalid input, dark appearance, and large text. Verify graph tap and scrub, skipped resolution, reminder progressive disclosure, and save-with-keyboard behavior with UI tests. Record findings in TESTING.md before release.
