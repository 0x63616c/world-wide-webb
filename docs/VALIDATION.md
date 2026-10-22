# Validation — 0.1.0

Tested on an Apple Silicon Mac running macOS 27.2, using Xcode 27.

## Passed

- Debug build and 12 XCTest tests: sample integrity, offsets, silence-gap preservation, file reopen/rename, interrupted-session recovery, corrupt metadata isolation, write failures, format changes, shortcut storage/display, and system-audio authorization mapping including unavailable/unknown results.
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
- Verified shortcut capture and reset to HYPR R. The disable toggle was subsequently removed; the chosen shortcut is always registered, except while capturing its replacement.
- Verified rename via the title pencil, recording context menu, and Return. The name field starts focused with its name selected, and the new name survived restarting the app.
- Shift-click selected two generated audio fixtures; the confirmation showed two recordings, and both were verified in Trash after deletion. These fixtures were generated tones, not microphone captures.
- Permission states use aligned green checks for current grants, red crosses with Enable for missing grants, and a neutral question mark if macOS cannot report system-audio authorization. The packaged app detected both existing grants automatically without an audio probe or test sound.
- Removed Check Access, cached Verified Before states, and the audio-test flow. Settings now has two compact groups and an unobtrusive Manage menu for existing grants.
- A second agent review caught mixed-state alignment, the unknown-status presentation, and helper dismissal when System Settings closes; all three were corrected.
- Rebuilt the signed Release app and reran all 12 tests after the permission redesign. Fresh permission denial/revocation remains in the manual coverage below.

## Playback and interaction refinement

- Command–B was exercised twice in the packaged app: the sidebar closed and reopened with the native toolbar label updating correctly.
- Callkeep now runs as a regular application, with Dock / Command–Tab eligibility and a reopen handler that presents the library. Menu-bar recording remains available.
- Permission labels now read `Allowed` followed by a tightly spaced green check, aligned against the right edge. Inspected the native Settings rendering with both existing grants, and confirmed the shortcut disable toggle is absent.
- Inline rename was exercised on a generated silent fixture: the title field selected the current name, Return saved the change to the library, and Escape discarded an edit. The actions menu lives in the native toolbar, with Move to Trash inside it.
- Playback progress is rendered at up to 60 Hz from a monotonic clock aligned with the scheduled audio start. The completion timer no longer drives visible progress. Scrubbing pauses once, previews locally, then seeks and optionally resumes on release.
- A silent 30-second fixture advanced, paused at a fractional position, sought from 4.295 to 14.795 seconds while remaining paused, and sought backward during playback while retaining the Pause control. The fixture was then moved to Trash through the actions menu; its folder was verified in Trash. User recordings were retained.
- Review caught and fixed selected-recording rename interrupting playback, draft loss on navigation, and an unpaired slider-completion edge case.
- The detail pane now fills the available width before applying its background, removing the contrasting side strips around capped-width recording/player content. Inspected the packaged player at full window width with the sidebar hidden.
- Manage opens the correct macOS Screen & System Audio Recording pane. The floating setup helper is limited to missing access and dismisses when granted or when the observed Settings window closes; a fresh missing-to-granted cycle remains manual coverage.

## Remaining manual coverage

- A real remote Zoom/Meet/Teams call with headphones, including a longer session and route changes.
- The final minimal recording screen during an active call; recording was left idle at the user's request.
- Global shortcut operation while another app is frontmost. Carbon registration succeeds; in-app key recording/display/reset were verified.
- Full permission-denial/revocation cycle and actual drag-and-drop granting on a fresh account. Current grants were preserved.
- Intel hardware, other supported macOS versions, prolonged disk pressure, and long-run drift across different audio devices.

The system-audio test exposed gaps when Core Audio suspended callbacks during silence. The writer now inserts timestamped silence; the regression test verifies sample positions and duration. Existing recordings made before that fix are not rewritten.

This is a signed local build, not an App Store or notarized public release. Transcription and captions are not part of version 0.1.

Automatic system-audio status uses an optional, private, read-only TCC function. It is isolated from the public Core Audio capture implementation and is not appropriate for App Store distribution. Unsupported results fall back to a neutral UI and the normal recording consent flow.

## GitHub CI

Run `39790316910` could not start: GitHub reported failed recent account payments or a spending limit requiring attention. This is an account/runner admission blocker, not a compile or test result. Local builds and tests above completed successfully.
