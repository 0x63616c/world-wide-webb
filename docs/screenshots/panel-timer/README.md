# Rectangular Timer

Real SwiftUI captures from the running iPad Pro 13-inch simulator, 1376×1032
points. The timer runs at normal speed; API fixtures supply only the surrounding
launcher apps. No generated image or accelerated countdown is used.

- `timer.png`: final ready face, with equal 22-point orange ticks, a seven-point
  stroke, generous edge padding and an earlier gradual turn around each corner. The countdown uses regular
  weight. Tap the orange duration to edit it; presets are inside the editor.
- `timer.mp4`: open Timer, tap the duration, start a 15-minute countdown, pause,
  return to Home, reopen, resume and reset. The fixed chevron Back button remains visible. Timer controls use icons with spoken labels.

The UI test launch argument `-timerDisableNotifications` prevents OS notification
permission prompts and sounds in the recording. It does not change the timer's
clock. Background sound delivery is subject to OS permissions and was not
verified by this recording.

Local validation: four countdown model tests and five catalog tests; two geometry
tests for the shared perimeter sampler; two UI regressions for custom completion,
pause/resume, leaving/reopening and reset; one native capture test. Local Xcode 27;
this UI change has not been published to TestFlight.
