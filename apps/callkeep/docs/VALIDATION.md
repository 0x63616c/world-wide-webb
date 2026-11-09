# Validation

Tested on an Apple Silicon Mac running macOS 27.2, using Xcode 27.

## Native iCloud, imports and Settings — November 2, 2026

- All 28 XCTest tests pass, including folder import, duplicate IDs, preserving originals, active recording rejection, path traversal and symlink rejection, unreadable audio cleanup, and legacy library discovery/migration.
- The Developer ID profile validates against the release certificate and production document-container entitlements. The signed native app resolves `iCloud.co.calum.callkeep`, opens its Documents directory, and discovers migrated recordings.
- Fixed a local Debug launch failure caused by an ad-hoc signed `Callkeep.debug.dylib` inside a Developer ID signed app. Nested dylibs are now signed before the app. The corrected build launches successfully.
- Inspected Settings in the native app: Storage fills the same width as Recording and Permissions; the storage toggle, Open iCloud Folder and both permission grants are visible.
- Refreshed all four README screenshots as native PNG captures with alpha at the rounded window corners. Library/playback/recording use generated fixtures, isolated from the user library; Settings hides the sidebar to exclude personal metadata. See [capture details](images/README.md).
- Cross-device synchronization and simultaneous editing remain unverified; concurrent editing is unsupported. Finder branding is checked after installing the provisioned release, because the preexisting installed Build 6 has the old folder configuration.

## Shortcut label and playback refresh — Build 9

- Hyper shortcuts display `HYPR + R` in Settings and recording-button help. All 28 tests pass with the updated label expectation.
- Storage refresh now reloads the selected player after a coordinated transfer and restores its position and prior playback state. The native build displayed the selected recording’s full duration after startup refresh and retained a 10-second seek after switching away and back. Audio playback was not started for this check.
- Updated the Settings screenshot with the actual new shortcut label.

## Saved waveform colors, sidebar spacing and Sparkle — Build 10

- All 30 XCTest tests pass, including independent source envelopes, delayed tracks, right-channel-only audio and short peaks outside the old sampling windows.
- The production updater delegate's recording/IO deferral harness passes without opening audio devices or installing software: checks are blocked while recording, installation remains pending during file operations, and becoming idle resumes the callback exactly once.
- Universal Release build succeeds. The Sparkle feed generator signs a packaged archive, validates version/URL/size metadata and verifies its archive signature. CI repeats this against the exact notarized release zip.
- Native previews show separate purple/teal playback colors before and after the playhead, a matching legend, and additional space above the recording list. Search and Shift-click range selection were exercised using generated recordings.
- Captured all four README images as transparent native PNGs with fictional fixtures; no user call content is published. A generated 24-minute 8 kHz two-track fixture's complete waveform envelope took about 0.20 seconds in an optimized build on the development M5 Pro. This is waveform extraction, not an ASR benchmark.
- Transcription models were researched, including Apple's public speech APIs and on-device language-model availability. Transcription and meeting detection are design proposals, separate from these shipped UI/updater changes; see [the model research](TRANSCRIPTION.md).

## Historical validation


## Live waveform and renaming — 0.1.3

- Independent microphone and system-audio levels now feed the same shared renderer in the main window and menu bar: purple for You, teal for Call audio, with blended overlap. Source values are sampled together and retain the existing smooth timestamp-based movement and Reduce Motion behavior.
- All 17 XCTest tests passed after these changes.
- Exercised the actual app views and recording lifecycle in a separate preview build with an isolated library and an audio-capture replacement that generates PCM. No microphone or system-audio device was opened. The README recording screenshot comes from this preview.
- Renamed while recording, observed the title in both the live view and sidebar, then inspected an on-disk checkpoint after 15 seconds: the new name and both audio tracks were retained. Escape discarded another edit. Clicking Stop with an unsubmitted name saved the latest edit; both audio tracks and the final name persisted after restarting the preview.
- Historical interruption notes no longer occupy the player. A synthetic interrupted fixture reopened with its sidebar indicator and a clean player; its detail is available in Recording Info. Legacy “Microphone disconnected” wording is displayed as “The microphone input stopped” without rewriting stored notes.
- A separate agent reviewed the changes and rendered preview; no material blockers remained.
- Release 0.1.3 (build 4) built with Developer ID signing; code-signature verification passed before and after packaging. The updated app reopened the existing library with the historical note removed from the player.
- Live FaceTime validation of the 0.1.1 audio-capture fix is still pending. This iteration validates the UI and generated-audio lifecycle, not real microphone quality.

## Audio and live waveform fixes — 0.1.1

- System capture now reads the aggregate device's actual input format, rather than assuming the tap description matches the callback. The aggregate contains only the tap, so a duplex output device cannot insert microphone channels ahead of system audio.
- Microphone capture enables Apple's voice processing and automatic gain control, selects the processed uplink for mono storage, and retries a stopped engine after hardware format changes. This addresses the very quiet raw microphone-array behavior described in [Mozilla's investigation](https://bugzilla.mozilla.org/show_bug.cgi?id=1896938#c22). [Apple documents](https://developer.apple.com/documentation/avfaudio/avaudioengineconfigurationchangenotification) that channel-count/sample-rate changes can stop the engine.
- New audio is converted to a stable 48 kHz format off the render callback. Converter latency is kept separate from actual missing input, and its tail is flushed without adding padding to recording duration.
- 17 XCTest tests pass. Added regressions for 3,072-frame 44.1 kHz callbacks (continuous output, correct 440 Hz pitch and duration), format changes with a real gap, a 44.1→48→44.1 kHz format cycle, auxiliary-channel exclusion, and right-channel metering.
- Live bars use timestamp-based positions rendered at up to 60 Hz, with a 100 ms entrance. Silent input keeps a stationary baseline; Reduce Motion uses a stationary meter. Both main-window and menu-bar waveforms share this renderer.
- Inspected the native waveform with synthetic levels in a disposable preview. A separate agent reviewed the waveform and audio changes; its findings were addressed.
- The tap-only aggregate was created and inspected on this Mac without starting an IO callback: Core Audio reported stereo 48 kHz input. No microphone or system-audio samples were captured by this probe.
- Signed Release build succeeded; code-signature verification passed.
- **Pending hardware validation:** the revised microphone/aggregate setup has not yet been exercised during a live FaceTime call. Unit tests establish sample conversion and timing, not real-device compatibility. The earlier live-capture result below applies to 0.1.0.

## Earlier checks (0.1.0)

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

The historical checks above used a signed local build. Current public releases are Developer ID signed and notarized by Apple. Transcription and captions are not part of version 0.1.

Automatic system-audio status uses an optional, private, read-only TCC function. It is isolated from the public Core Audio capture implementation and is not appropriate for App Store distribution. Unsupported results fall back to a neutral UI and the normal recording consent flow.

## GitHub CI

Historical run `39790316910` could not start: GitHub reported failed recent account payments or a spending limit requiring attention. This is an account/runner admission blocker, not a compile or test result. Local builds and tests above completed successfully.

Later CI runs have completed and published notarized Homebrew releases successfully; the earlier runner admission blocker is resolved.

## Local transcription

- Built the universal app with Xcode 27.2 and pinned FluidAudio 0.18.2 / WhisperKit 1.1.1 dependencies. CI explicitly selects Xcode 26.2.
- 40 XCTest tests pass, including the optional real-engine test when supplied local weights. The regular suite skips that weight-dependent test; updater and playback harnesses also pass.
- Both engines recognized generated English speech. The native app downloaded both models with checksum verification and rendered a Parakeet two-track transcript with You / Call audio labels and the call track’s two-second offset. No personal recordings were used for published fixtures or recognition tests.
- Real-call accuracy, extended recording sessions, additional macOS versions and hardware remain manual coverage.

- Playback was exercised with generated speech in the combined audio/transcript view; the current phrase highlighted during playback, and clicking its timestamp sought to the right point.
- Local builds show `Callkeep (Dev)` and set a DEV Dock badge. The sidebar shows the version instead of the shortcut hint and dates include the year. Production archives require an explicit CI marker before Sparkle publication.
- Call reminder filtering/debounce tests pass, including FaceTime helpers; a read-only Core Audio scan succeeds. Live-call detection and the user’s macOS notification permission/delivery are separate manual checks.
