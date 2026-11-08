# Tendr 1.0.0 (17)

## Schedules

**Custom dates.** A third cadence sits beside Weekdays and Every few days. It opens a calendar, you tap each day you plan to inject, and the chosen dates drive the next-dose card, the overdue check and reminders. This suits an uneven rhythm — three days, then five, then four — that no single interval can express. Chosen dates are listed under the calendar and can be removed individually. See [the editor](screenshots/build17-schedule-custom.png) and [the summary](screenshots/build17-treatment-custom.png).

**Clearing.** The schedule editor now has a destructive *Clear schedule* action behind a confirmation. It empties every cadence, turns reminders off and cancels pending notifications. Doses already logged are untouched. Treatment then reads *No schedule set*, and Home offers *Set your schedule* again. See [the cleared state](screenshots/build17-treatment-cleared.png).

`DoseSchedule.cadence` derives `none`, `weekdays`, `interval` or `custom` from the stored fields, so no separate mode flag can disagree with them. Saving a cadence clears the other two, so switching never leaves a stale rule behind. Reminders for chosen dates and intervals are scheduled as one-shot notifications; weekday reminders still repeat.

## Treatment summary

The cadence line and the reminder state now share one row, cadence on the left and reminders on the right, instead of stacking onto separate lines.

## Medication projection

The dashed projection includes the doses your schedule implies, drawn at the average of your last three recorded doses and marked with a point at each future date, so you can see the shape of the coming weeks. These are estimates for the graph only: they are never written to the journal, never counted as taken, and never change the live figure. With no recorded dose there is no usual amount and nothing is drawn. A date you have already logged or explicitly planned keeps its own record instead of gaining a second projected dose. The "About this graph" copy was corrected to match.

## Home cards

The whole medication card opens the medication screen, not only the chart. The weight tile moves to the Progress tab rather than presenting Progress as a sheet, so it lands where the rest of the weight history lives; the sheet mode has been removed.

## Weight chart

Interpolation changed from `catmullRom` to `monotone`. Catmull-Rom overshoots between readings, inventing dips and peaks the scale never recorded. Monotone cubic interpolation cannot overshoot, so the curve stays inside the data. See [Home](screenshots/build17-home.png).

## Apple Health

Settings shows when body weight was last read, alongside the existing status, and states the refresh rule: Tendr re-reads on every foreground and whenever you tap Sync. There is no background observer query, so Tendr does not update while closed.

## Compatibility

`DoseSchedule` decodes field by field, so journals written before `customDates` existed still open with an empty list, and `lastHealthKitSync` is absent rather than zero until the first sync.

## Verification

25 core tests and 13 UI tests passed on iOS 26.2, Tend QA Pro Max. New regressions cover uneven custom gaps, clearing, projection amounts and exclusions, projections never touching the current level, and the older-journal decode. UI coverage asserts the custom calendar, the clear flow, whole-card navigation and the weight tile's tab switch. Passing tests do not imply clinical validation.
