# Tendr 1.0.0 (6)

September 10, 2026. Uploaded at 14:35 Pacific. App Store Connect reports **Testing** for Owner Preview, with 90 days remaining. What to Test notes saved. Build ID: `edd55607-4751-4eff-b736-781b3e604703`. Installation of build 6 on a physical device has not been verified.

## Changes

- Flat full-width bottom navigation replaces the floating pill; all five destinations remain.
- Settings → Live estimate offers 3–7 decimal places, default 5, persisted across launches.
- Semaglutide and tirzepatide use published two-compartment absorption and clearance reference models. The graph rises gradually after injections. This is an estimate of absorbed systemic medication, not a measurement or a personalized dosing recommendation. [Model, sources and limits](MEDICATION-MODEL.md).
- Explicit future planned doses always appear in projections; the + Plans toggle is removed. Skipped doses and overdue unfulfilled plans do not add medication.
- Dose preferences remember mg/mL/Units, syringe setup is separate, vial illustrations are consistent, vial editor separators extend under units, and pounds display as lbs. [Dose entry details](DOSE-ENTRY-POLISH.md).

## Verification

14 core tests and 11 UI tests passed on iOS 26.2 Pro Max. Precision persistence and absorption tests were observed failing before implementation, then passing. Model results match an independent RK4 integration at five elapsed times for both medications. Plan filtering is tested independently. Release archive succeeded.

Reviewed actual simulator screenshots with synthetic data:

- [Home](screenshots/build6-home.png)
- [Collapsed Home](screenshots/build6-polish-home-collapsed.png)
- [Journal](screenshots/build6-journal.png)
- [Dose entry](screenshots/build6-log-dose.png)
- [Vial editor](screenshots/build6-edit-vial.png)

This release covers the current feedback batch. Medication identity migration and the remaining broader product backlog are not included.
