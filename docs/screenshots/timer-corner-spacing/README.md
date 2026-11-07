# Panel Timer

Captured on the running 1366 × 1024-point iPad simulator at 2× scale.

- `timer.png`: Two marks straddle each corner. The tenth mark from the gap
  on either side begins the turn; the slant increases toward the gap.
- `set-duration.png`: The Set Timer editor retains the same outline.
- `notification.png` and `stop.png`: The completion banner and the Stop
  control after opening Timer from the banner.
- `timer-demo.mp4`: Open Set Timer, run a short timer, tap the banner from
  Classic and stop the alarm.

Timer counts down silently. At zero, the active Panel plays a repeating
alarm and posts a local Panel notification. Tapping it opens Timer, where
Stop silences the alarm and readies the same duration for another run.
If the app is suspended, iPadOS delivers the scheduled notification when
notifications are enabled. Tapping it opens the same Timer page.
