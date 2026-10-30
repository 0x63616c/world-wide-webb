# Native alarm ownership (WWW-37)

The web alarm runtime remains the default on browsers, Expo, and older native
shells. A compatible native shell can call
`window.__CONTROL_CENTER_SET_ALARM_OWNER__(true)` on the trusted board document.
The promise resolves `true` only after React has committed the ownership change
and cleaned up the web alarm cue and five-second repeat timer. Superseded
requests resolve `false`. Unmount removes the function and rejects pending work.

While native owns ringing, the web still polls alarm data but renders no alarm
dialog, plays no alarm cue, and sends no `syncNextAlarm` bridge updates. Other
web sounds and features are unchanged. Before calling the function with `false`,
the shell must cancel its system alarm. Web ringing and next-alarm syncing then
resume from the current server snapshot.

The Panel shell requires the function to exist and acknowledge before it enables
native alarms. This permits either deployment order: a new web bundle does
nothing until a shell opts in; a new shell with an old web bundle falls back to
the web. Main-frame origin checks and document-navigation cancellation belong
to the native shell. No credentials or server API changes are part of this seam.

Verification: `bunx vitest run features/events/web/__tests__/AlarmRuntime.test.tsx
features/events/api.test.ts features/events/http.test.ts` (23 tests), plus
`bun run typecheck`. Tests cover active-cue cleanup before acknowledgement,
repeated and superseded handoffs, resuming web ringing and sync, browser defaults,
and unmount cleanup. Physical wall verification is still required before enabling
the native module flag.
