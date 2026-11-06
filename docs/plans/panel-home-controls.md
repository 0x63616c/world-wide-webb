# Panel Home and controls release

Work from current main in the dedicated panel-home-controls worktree. Keep this release separate from PR #908 and carry over only pieces that directly solve the requested behavior.

- [ ] Settings: remove the Apps page and app-specific Reduce Motion override. Keep the system accessibility preference. Add a slider for the global return-to-clock delay.
- [ ] Timer: play countdown and completion sounds. Keep the panel awake and prevent automatic return while timing. Also suppress automatic return while a dog walk is active.
- [ ] Home: keep its existing time and date. Use native Liquid Glass alone with a tighter corner radius and the existing 8-point inset. Move the dial, glass and app selectors together when an app opens and closes.
- [ ] Clock: retain the green face and add three distinct faces. Swipe horizontally in either direction to cycle with the same shrink-and-slide motion as app navigation. Tap to open Home. Prevent the first face flashing green at night before weather loads.
- [ ] Tesla: show the last successful reading when the car is offline or reports no data. Distinguish it from a fresh reading, and keep the unavailable state for a car with no history.
- [ ] Climate: replace setpoint buttons with a full-page vertical slider. Put Off, Cool, Heat, Cool/Heat and fan choices in More. Show optimistic climate and fan selections without spinners and restore confirmed values on failure.
- [ ] Dog walks: scale the selected period's daily chart to the greater of 60 minutes and its highest daily total. Remove the notification created on walk start.
- [ ] Photos and Activity: remove the visible Lock button while preserving PIN and automatic relock. Restore Swift panel wake capture so new Activity sessions reach the server. Check the upload contract and validate the physical iPad path where available.
- [ ] Verify typecheck, backend tests and native builds. Run focused interaction checks, capture the actual iPad simulator at 1366×1024, and share a video of visible changes.
- [ ] Commit and push the scoped changes. Open the PR with pinned screenshot evidence, fix CI, and merge once green. Verify production deployment and Apple processing of the TestFlight build, then notify Calum in this chat.
