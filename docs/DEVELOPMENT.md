# Development

## Build

Open `Callkeep.xcodeproj` in Xcode 16 or later, select the Callkeep scheme, and run. The checked-in project needs no generator or package downloads.

Or:

```sh
./Scripts/build.sh
open build/Build/Products/Release/Callkeep.app
```

The default build uses ad-hoc signing for local development. To build with your own Developer ID certificate:

```sh
CALLKEEP_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)' ./Scripts/build.sh
```

A Developer ID signature alone is not notarization. Notarize a distribution build before shipping it to other Macs over the internet. The app is deliberately not sandboxed in this first iteration.

`project.yml` is the XcodeGen source. After changing targets or adding files, run `xcodegen generate` and commit the generated project as well.

## Tests

```sh
./Scripts/test.sh
```

Tests cover audio samples and timing, file reopening, metadata updates, interrupted-session recovery, corrupt metadata isolation, write failures, and audio-format changes. See [validation](VALIDATION.md) for the actual release checks and remaining hardware checks.

## Permissions

Microphone authorization is read from AVFoundation. Core Audio does not provide a public system-audio authorization status query. For this local prototype, `SystemAudioAuthorization` optionally loads the private, read-only `TCCAccessPreflight` function for `kTCCServiceAudioCapture`, following the approach documented in [AudioCap](https://github.com/insidegui/AudioCap/blob/main/AudioCap/ProcessTap/AudioRecordingPermission.swift). Status checks do not capture audio, play a sound, or save files. They refresh while Settings or the setup helper is visible and when the app becomes active.

This private status API is not suitable for an App Store build and may change in macOS. If unavailable or unrecognized, the UI shows a neutral state, never a cached green check. Recording remains available so the public Core Audio capture flow can request consent. Actual recording still uses public Core Audio APIs. The app does not request Screen Recording or Accessibility access.

The floating helper is an independently implemented nonactivating AppKit panel with a native file-URL drag source. Its interaction was informed by [cmux's onboarding panel](https://github.com/manaflow-ai/cmux/blob/a84b7c278b5444820cff5b1f67addcf980f02b90/Sources/App/ComputerUseOnboardingWindowController.swift) and [drag source](https://github.com/manaflow-ai/cmux/blob/a84b7c278b5444820cff5b1f67addcf980f02b90/Sources/App/ComputerUseAppDragSourceView.swift). System Settings keeps focus during the drag. The helper dismisses after access is enabled or the observed Settings window closes.

## Architecture

- `AudioCapture`: Core Audio system tap + AVAudioEngine microphone tap.
- `TrackWriter`: owned buffer copies, bounded write backlog, serial disk IO, peak levels and silence-gap preservation.
- `RecordingStore`: atomic JSON metadata, discovery, and crash recovery.
- `AppModel`: permission flow, start/stop, checkpoints, sleep/device/disk safeguards.
- `Playback`: timestamp-offset playback of separate tracks behind a single set of playback controls.
- SwiftUI provides the native split-view library, toolbar, settings and menu-bar panel; Carbon registers the global shortcut without Accessibility access.

Active audio stays local; finished recordings move to iCloud Drive when enabled and available. Future transcription can read these files without changing the capture pipeline.

## Automatic releases and Homebrew

Every push to `main` (including merges) runs the tests, then builds a universal
Apple silicon/Intel app, increments the latest release's patch version, and
publishes a zip to GitHub Releases. Pull requests run tests without publishing.
The release version overrides the checked-in marketing version at build time.
Runs queue sequentially, and rerunning a released commit reuses its tag and
published archive rather than replacing it.

The release job updates `Casks/callkeep.rb` in `0x63616c/homebrew-tap` with the
published archive's SHA-256. `HOMEBREW_TAP_DEPLOY_KEY` is a dedicated write deploy
key for that tap only. The workflow's GitHub token can publish releases only in
Callkeep. No Apple signing secrets are configured: releases remain ad-hoc signed
and unnotarized. Uninstall and zap preserve local and iCloud recording files.
