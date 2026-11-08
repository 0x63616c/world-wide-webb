# Tend

A private, native GLP-1 treatment journal. No account, backend, ads, or telemetry.

## Product
- Today: next scheduled dose, quick logging, recent weight and a calm progress chart.
- Progress: date-range charts, total change, percentage change, weekly rate; future weight entries explicitly planned and excluded from actual analytics.
- Journal: editable dose/weight records, notes, past and future dates, taken/planned/skipped states.
- Schedule: chosen weekdays and local reminder time; actual dose date is independent from intended date. No inferred medical dosing advice.
- Treatment: medication, vial concentration and volume, schedule and conditional reminder controls.
- Settings: display weight unit, appearance and privacy.
- Discover: original bundled articles and recipes, with the explicitly coming-soon assistant preview.

Concentration is not a dose. Dose amount is entered independently in mg; do not infer a prescribed dose from the user's concentration example. Preserve medication and concentration snapshots on historical records.

## Visual direction
True black in dark mode, neutral charcoal surfaces, restrained lavender and teal for tracking data. San Francisco text, native collapsing navigation titles, uneven dose/vial row and tappable charts. Discover uses flat editorial cards with strong typography. Decorative gradients and oversized article icons were rejected and removed. Light appearance is available through Settings.

## Test seams
User authorization covers TDD for the complete app. Public behavioral seams: record validation and persistence round trips; chronologically correct analytics; schedule occurrences in local calendar time; actual/planned matching; UI create/edit/relaunch flows. Work one red/green slice at a time. Capture failures and passing results in docs/TESTING.md.

## Release completion
Working simulator app, UI tests, visually inspected screenshots with synthetic data, public GitHub source with MIT license and setup documentation, signed archive, uploaded build, verified TestFlight processing and availability. A signed archive alone is not TestFlight completion.

## Owner refinements
- UI first: original ivory/serif wellness branding rejected. Native iOS foundation with purposeful custom interactions, clean grouped surfaces, strong dark mode. No slogans or on-screen essays.
- Working display name changed from Still to Tend (name provisional; internal target can remain Still until release naming is settled).
- Dashboard leads with estimated medication decay over history/future, current estimate, half-life assumptions, and weight analytics. Clearly distinguish estimates from measured body/blood levels and future plans from actuals. No dose recommendations.
- Overdue occurrences stay unresolved until linked to a taken/skipped record; recording late never silently moves the schedule.
- Vial received date, volume, concentration; explicit syringe scale for unit entry. No assumption that arbitrary syringe units are U-100.
- Preview exact notification copy inside schedule settings.
- AI assistant: coming-soon visual preview only; no fake live responses or backend. Future scope should focus on explaining personal logs and preparing clinician questions, with separately consented data handling before any cloud AI transmission.

## Launch direction
Prove the core with a small TestFlight group first. Record a short real-app demo: log in units, resolve overdue dose, scrub the estimate graph, add a weight. Public repository should show actual light/dark screenshots and the privacy model. Gather feedback on logging speed and comprehension before paid promotion. No external marketing messages or spend authorized.
