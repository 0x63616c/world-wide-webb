# Call reminders

Enable **Settings → Overlays → Remind me to record calls** to receive a **Meeting detected** card with **Record** and **Dismiss**. It never starts recording automatically.

Callkeep listens for Core Audio process and active-input changes and identifies supported apps from bundle IDs and their helper-app paths. It offers one reminder after the delay selected in Settings → Overlays (0.5 seconds by default), measured from the first detected activity. macOS scheduling and scanning can add a little time. If an activity notification is missed or unavailable, a twice-per-second fallback scan can add up to about half a second. Dismissal lasts until that app has been idle for 15 seconds. Calls already being recorded do not prompt again when recording stops. This reads activity metadata; it does not capture audio or inspect screen contents.

Supported apps include **FaceTime**, **Phone**, Zoom, Teams, Slack, Safari, Chrome, Edge, Arc, Brave and Firefox. Callkeep and Wispr Flow are ignored. Apple's shared `avconferenced` service can be attributed to Phone or FaceTime while those apps are running. If both are open and only the shared service is visible, the reminder says “Phone or FaceTime”. This is a heuristic and can also match other Apple conferencing activity while either app is open. Phone call detection has not yet been verified in a live call.

Activity is a reminder signal, not definitive meeting detection. Browser voice messages or dictation may also trigger a card; some browser helpers cannot be attributed to a specific app, and browser tabs are not identified. A call that never opens its microphone may be missed. Calendar access is not requested.

Validation covers app matching, FaceTime's helper condition, debounce, short gaps, dismissal/reset, and suppression while recording. A read-only scan succeeded on the development Mac. Detection in a live FaceTime or third-party call remains a hardware check; no calls to other people were placed during development.

Apple API references: [process list](https://developer.apple.com/documentation/coreaudio/kaudiohardwarepropertyprocessobjectlist), [input activity](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput), [process ID](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertypid).
