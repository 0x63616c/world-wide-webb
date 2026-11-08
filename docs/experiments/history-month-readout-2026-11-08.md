# Month History selection readout

Owner request, November 8: when scrubbing the month chart, show the selected
calendar date in the lower-left readout, for example **November 2**, instead of
the bare day number **2**. Keep the corresponding fold count on the right.

The preserved iOS experiment in `codex/live-history-refinements` already uses
`Text(bin.start, format: .dateTime.month(.wide).day())` for this readout.
The root supplies the saved home timezone, and SwiftUI supplies the locale;
the selected date therefore follows the same calendar day as the chart bins.
Other chart ranges retain their existing selection labels.

The screenshot target compiled successfully on the pinned Duo simulator on
November 8. Interactive scrubbing remains unverified through the available native UI
automation, which does not expose the development Simulator. Rendered month,
Today, Patterns, Join, notifications and tip-jar fixtures were inspected. No
Penpot changes are included. Physical-device acceptance remains deferred.

The owner explicitly resumed app implementation and TestFlight shipping on
November 8, and confirmed Penpot is outside the current work. Issue
[#52](https://github.com/0x63616c/folding/issues/52) tracks the release. Existing
Penpot experiments remain preserved. Broader deferred shipping checks remain open.

Shipped in TestFlight **0.1.8 (9)**; see [release evidence](testflight-refinements-2026-11-08.md).
