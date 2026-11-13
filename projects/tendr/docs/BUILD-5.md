# Build 5 — Tendr polish

Version 1.0.0 (5), September 10, 2026.

- Rename the installed app, Home title, About and reminder copy to Tendr.
- Replace cramped Journal and Progress segmented filters with matching 44-point buttons, including selected accessibility state and horizontal overflow for larger text.
- Use the same flat-color vial illustration on Home and Treatment.
- Remove the separate Home date row while preserving native large-title collapse.

Bundle identity, local storage and medication calculations are unchanged.

Validation: existing preview/navigation/logging UI test passed; targeted filter selection test passed on iOS 26.2 Pro Max. Reviewed actual light/dark simulator screenshots and collapsed Home title. Prior build 4 full suite passed 12 core and 8 UI tests; this patch did not rerun that full suite.

Screenshots use synthetic data: [Home](screenshots/polish-home-dark.png), [collapsed Home](screenshots/polish-home-collapsed-dark.png), [Journal](screenshots/polish-journal-dark.png), [Treatment](screenshots/polish-treatment-dark.png), [Progress](screenshots/polish-progress-dark.png).

Verified in App Store Connect: upload complete, build 1.0.0 (5) Testing in Owner Preview (1 tester, 3 builds), expires in 90 days. What to Test notes saved. App Store Connect name saved as Tendr: Dose & Weight Journal. Upload succeeded September 10 at 12:16 Pacific. Physical build 5 installation is not verified.
