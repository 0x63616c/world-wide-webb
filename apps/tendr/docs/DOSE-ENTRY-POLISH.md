# Dose entry polish

- Settings → Dose entry stores preferred mg/mL/Units and confirmed U-100 calibration. New dose saves remember the chosen unit atomically with the dose; editing older entries does not change the preference.
- Dose logging uses a compact status menu and a separate syringe setup sheet. Existing historical syringe calibration remains available when editing.
- Dose selection and vial editing reuse the Home/Treatment vial illustration. Vial editor labels remain visible and separators extend beneath the units.
- Pounds display as lbs; persisted weight unit values remain unchanged for compatibility.

Verified September 10, 2026: 12 core tests and 10 UI tests pass on iOS 26.2 Pro Max. The preference/relaunch test was observed failing before implementation, then passing. Reviewed actual synthetic-data screenshots: [Dose](screenshots/dose-polish-log-dose.png), [Vial](screenshots/dose-polish-edit-vial.png).

Shipped in [build 6](BUILD-6.md), verified Testing for Owner Preview on September 10, 2026.
