# Call reminders

Enable **Settings → Overlays → Remind me to record calls** to receive a **Meeting detected** card with **Record** and **Dismiss**. It never starts recording automatically.

Callkeep reads Core Audio's process list and active-input flags twice a second. It identifies supported apps from bundle IDs and their helper-app paths, then offers one reminder after the delay selected in Settings → Overlays (0.5 seconds by default). Scanning can add up to about half a second. Dismissal lasts until that app has been idle for 15 seconds. Calls already being recorded do not prompt again when recording stops. This reads activity metadata; it does not capture audio or inspect screen contents.

Supported apps include **FaceTime**, Zoom, Teams, Slack, Safari, Chrome, Edge, Arc, Brave and Firefox. Callkeep and Wispr Flow are ignored. FaceTime can delegate microphone capture to `avconferenced`; Callkeep attributes that shared service to FaceTime only while FaceTime is running. This is a heuristic and can also match other Apple conferencing activity while FaceTime is open.

Activity is a reminder signal, not definitive meeting detection. Browser voice messages or dictation may also trigger a card; some browser helpers cannot be attributed to a specific app, and browser tabs are not identified. A call that never opens its microphone may be missed. Calendar access is not requested.

Validation covers app matching, FaceTime's helper condition, debounce, short gaps, dismissal/reset, and suppression while recording. A read-only scan succeeded on the development Mac. Detection in a live FaceTime or third-party call remains a hardware check; no calls to other people were placed during development.

Apple API references: [process list](https://developer.apple.com/documentation/coreaudio/kaudiohardwarepropertyprocessobjectlist), [input activity](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput), [process ID](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertypid).
