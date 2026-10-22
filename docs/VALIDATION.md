# Validation — 0.1.0

Tested on an Apple Silicon Mac running macOS 27.2, using Xcode 27.

## Passed

- Debug build and 10 XCTest tests: sample integrity, offsets, silence-gap preservation, file reopen/rename, interrupted-session recovery, corrupt metadata isolation, write failures, format changes, and shortcut storage/display.
- Release build with Developer ID signing; `codesign --verify --deep --strict` passed.
- A real microphone + system-audio capture produced nonzero audio in both local files. Measured peaks were 0.426 and 0.772 respectively. A generated spoken test phrase was played as system audio. No recorded content was uploaded.
- Saved recordings reopened in the packaged app. Playback advanced and paused correctly.
- Shift-click selected a contiguous range and a three-recording Trash confirmation showed the correct count; cancellation kept all calls.
- Two disposable metadata fixtures were selected and moved to Trash together through the packaged UI. Existing recordings were preserved.
- Shortcut capture changed HYPR R to ⇧⌘K; Reset to Default restored HYPR R.
- The System Audio settings link opened macOS's Screen & System Audio Recording pane, where Callkeep appeared under System Audio Recording Only.
- Native rendering inspected for the library, playback, selection state, deletion confirmation, Settings, recording-access window, and draggable-app help. The initial recording screen was also exercised before the minimal-UI revision.

## Settings and library redesign

- Settings and recording access now share the main window. The sidebar Settings button and Command-comma open the same page; Recordings returns to the library even when empty.
- A separate agent critiqued the original UI and two rendered revisions. The final review found no remaining material UX blockers.
- Inspected normal and compact native layouts, including a 360-point sidebar. The detail pane now enforces a 500-point minimum to keep status and action columns aligned.
- Verified shortcut capture, reset to HYPR R, and that disabling the shortcut disables the recorder control.
- Verified rename via the title pencil, recording context menu, and Return. The name field starts focused with its name selected, and the new name survived restarting the app.
- Shift-click selected two generated audio fixtures; the confirmation showed two recordings, and both were verified in Trash after deletion. These fixtures were generated tones, not microphone captures.
- Permission states use a green check for current success, red cross for known microphone denial, orange warning for an unsuccessful audio check, and neutral states for unchecked or earlier verification. An unsuccessful check now clears persisted verification.
- Rebuilt the signed Release app and reran all 10 tests after the redesign. Fresh permission denial/revocation remains in the manual coverage below.

## Remaining manual coverage

- A real remote Zoom/Meet/Teams call with headphones, including a longer session and route changes.
- The final minimal recording screen during an active call; recording was left idle at the user's request.
- Global shortcut operation while another app is frontmost. Carbon registration succeeds; in-app key recording/display/reset were verified.
- Full permission-denial/revocation cycle and actual drag-and-drop granting on a fresh account. Current grants were preserved.
- Intel hardware, other supported macOS versions, prolonged disk pressure, and long-run drift across different audio devices.

The system-audio test exposed gaps when Core Audio suspended callbacks during silence. The writer now inserts timestamped silence; the regression test verifies sample positions and duration. Existing recordings made before that fix are not rewritten.

This is a signed local build, not an App Store or notarized public release. Transcription and captions are not part of version 0.1.

## GitHub CI

Run `39790316910` could not start: GitHub reported failed recent account payments or a spending limit requiring attention. This is an account/runner admission blocker, not a compile or test result. Local builds and tests above completed successfully.
