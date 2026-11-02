# Recording and storage

## Capture

- **Microphone:** the macOS default input device, captured independently of the calling app with Apple voice processing and automatic gain control. Muting in Zoom does **not** mute this recording.
- **Computer audio:** audio from all applications through a Core Audio process tap. It captures digital audio, including when using headphones; it is not a microphone recording of the speakers.
- The app does not join calls, access a meeting account, or upload audio to a Callkeep service. iCloud Drive handles uploads when enabled. Get agreement from participants before recording.
- Headphones avoid the remote voice being picked up again by your microphone. Speaker playback can cause doubled voices when listening to both tracks.
- Changes to the microphone engine’s format are retried automatically, preserving the pause on the recording timeline. Changing the default input/output devices or putting the Mac to sleep stops and saves the recording, rather than silently recording from a different source. Restart after changing devices.
- Playback inside Callkeep is disabled during recording to avoid recording its own playback.

## During a recording

The live waveform overlays your microphone in purple and computer audio in teal. Both use the same timeline; overlapping activity blends together. The colors identify audio sources, not individual remote speakers.

Click the recording title’s pencil to rename it without stopping. Return saves, Escape cancels, and leaving the field saves the edit. The name is kept through checkpoints and the final save.

Interrupted recordings have a small indicator in the library. Open **Recording actions → Recording Info** for the reason. New recording failures still appear as a dismissible alert.

## Files

`~/Library/Application Support/Callkeep/Recordings/<recording UUID>/`

Each folder contains `microphone.caf`, `system-audio.caf`, and `recording.json`. New recordings contain 16-bit PCM at 48 kHz (mono microphone, stereo computer audio). Source audio is resampled when needed; CAF supports long recordings. Metadata includes the start time, each track's offset from a shared monotonic clock, sample rate, channel count, and actual duration. Files remain usable independently of the app.

At 48 kHz, mono microphone + stereo computer audio uses approximately **1 GB/hour**. There is no automatic deletion. The recorder checks free space every five seconds and stops below 250 MB. Deleted recordings go to the macOS Trash.

Metadata is written atomically and checkpointed during recording. If the app exits unexpectedly, the next launch marks the session interrupted and inspects any surviving audio. A damaged metadata file is reported without deleting its audio. Very early crashes before the first checkpoint may lose precise track offsets.

## iCloud Drive

By default, finished recordings (including interrupted recordings) move from the local capture directory to **iCloud Drive → Callkeep**, preserving their audio and metadata folders. Existing recordings move on launch too. Active recordings always stay local until their files are closed. macOS handles uploading, including after an offline recording. A move to this folder is not confirmation that upload has completed; check Finder’s iCloud status.

Enabling iCloud storage prepares **iCloud Drive → Callkeep** immediately, even before the first recording. **Open iCloud Folder** opens that destination in Finder; **Retry iCloud Drive** appears if setup or a move fails.

In **Settings → Storage**, disable automatic moves to keep new recordings local, or use **Retry iCloud Drive** after enabling iCloud Drive in macOS. If the destination is unavailable or a move fails, local files are kept. Existing iCloud recordings remain visible when automatic moves are disabled. Deleting an iCloud recording also deletes it on other devices.

This uses an ordinary `Callkeep` folder in the signed-in user’s iCloud Drive, rather than a provisioned app ubiquity container, so local ad-hoc builds work without an Apple Developer provisioning profile. It does not create an iCloud container or change signing entitlements. Files managed by iCloud may need downloading before playback; Finder can download the recording folder or keep it downloaded. Library discovery refreshes on launch and when retrying iCloud Drive. Simultaneous editing from multiple Macs is not supported.
