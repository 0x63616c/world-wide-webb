# Callkeep

A native macOS menu-bar recorder that keeps both sides of a call on your Mac.

**Version 0.1 · macOS 15 or later · SwiftUI + AppKit · No external dependencies**

## First version

- Start and stop from the menu bar, recording library, or **Hyper–R** (Control–Option–Shift–Command–R).
- See microphone and computer-audio levels while recording.
- Browse, search, rename, play, and trash past recordings.
- Play each call as one recording.
- Keep original, lossless audio for transcription later.
- Recover interrupted recordings when reopening the app.
- Record a custom keyboard shortcut, disable it, or reset to **HYPR R**.
- Select multiple calls with Shift-click / Command-click, then move them to Trash.
- Review required permissions and open System Settings with a draggable app tile.

Callkeep is a recorder. Transcription, live captions, automatic call detection, and per-app audio selection are future work.

## Run

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

## First recording

1. Open Callkeep and click **New recording**.
2. In **Recording Access**, allow the microphone and choose **Check Access** for system audio. A brief sound checks capture without saving anything. If needed, use **Open System Audio Settings**; a draggable app tile helps when Callkeep is missing from the list.
3. Close setup and start recording. The waveform shows incoming audio.
4. Press **Hyper–R** or **Stop recording** to save.
5. Select the recording in the library and play it. Use Shift-click / Command-click to select several, then the Trash button or Command–Delete to delete them together.

Closing the library window keeps the recorder running in the menu bar. Quitting saves an active recording. No shortcut remapping tool is needed if you press all four modifiers yourself; an existing Caps Lock → Hyper mapping works too.

## What is recorded

- **Microphone:** the macOS default input device, captured independently of the calling app. Muting in Zoom does **not** mute this recording.
- **Computer audio:** audio from all applications through a Core Audio process tap. It captures digital audio, including when using headphones; it is not a microphone recording of the speakers.
- The app does not join calls, access a meeting account, or upload audio. Get agreement from participants before recording.
- Headphones avoid the remote voice being picked up again by your microphone. Speaker playback can cause doubled voices when listening to both tracks.
- Changing the default input/output devices or putting the Mac to sleep stops and saves the recording, rather than silently recording from a different source. Restart after changing devices.
- Playback inside Callkeep is disabled during recording to avoid recording its own playback.

## Where audio lives

`~/Library/Application Support/Callkeep/Recordings/<recording UUID>/`

Each folder contains `microphone.caf`, `system-audio.caf`, and `recording.json`. CAF contains 16-bit PCM at the source sample rate and supports long recordings. Metadata includes the start time, each track's offset from a shared monotonic clock, sample rate, channel count, and actual duration. Files remain usable independently of the app.

At 48 kHz, mono microphone + stereo computer audio uses approximately **1 GB/hour**. There is no automatic deletion. The recorder checks free space every five seconds and stops below 250 MB. Deleted recordings go to the macOS Trash.

Metadata is written atomically and checkpointed during recording. If the app exits unexpectedly, the next launch marks the session interrupted and inspects any surviving audio. A damaged metadata file is reported without deleting its audio. Very early crashes before the first checkpoint may lose precise track offsets.

## Test

```sh
./Scripts/test.sh
```

Tests cover audio samples and timing, file reopening, metadata updates, interrupted-session recovery, corrupt metadata isolation, write failures, and audio-format changes. See [validation](docs/VALIDATION.md) for the actual release checks and remaining hardware checks.

## Permissions

Microphone authorization is read from AVFoundation. Core Audio does not provide a public system-audio authorization status query. Callkeep verifies actual audio delivery instead of using private TCC APIs or claiming permission from silence. On later launches, the UI distinguishes **Previously verified** from a fresh check. A denied permission, muted output, or silent source can require another check with audio playing. No audio from the permission check is saved. The app does not request Screen Recording or Accessibility access.

## Architecture

- `AudioCapture`: Core Audio system tap + AVAudioEngine microphone tap.
- `TrackWriter`: owned buffer copies, bounded write backlog, serial disk IO, peak levels and silence-gap preservation.
- `RecordingStore`: atomic JSON metadata, discovery, and crash recovery.
- `AppModel`: permission flow, start/stop, checkpoints, sleep/device/disk safeguards.
- `Playback`: timestamp-offset playback of separate tracks with independent source selection.
- SwiftUI provides the native split-view library, toolbar, settings and menu-bar panel; Carbon registers the global shortcut without Accessibility access.

All original audio stays local. Future transcription can read these files without changing the capture pipeline.
