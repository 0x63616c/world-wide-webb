# Recording and storage

## Capture

- **Microphone:** the macOS default input device, captured independently of the calling app. Muting in Zoom does **not** mute this recording.
- **Computer audio:** audio from all applications through a Core Audio process tap. It captures digital audio, including when using headphones; it is not a microphone recording of the speakers.
- The app does not join calls, access a meeting account, or upload audio. Get agreement from participants before recording.
- Headphones avoid the remote voice being picked up again by your microphone. Speaker playback can cause doubled voices when listening to both tracks.
- Changing the default input/output devices or putting the Mac to sleep stops and saves the recording, rather than silently recording from a different source. Restart after changing devices.
- Playback inside Callkeep is disabled during recording to avoid recording its own playback.

## Files

`~/Library/Application Support/Callkeep/Recordings/<recording UUID>/`

Each folder contains `microphone.caf`, `system-audio.caf`, and `recording.json`. CAF contains 16-bit PCM at the source sample rate and supports long recordings. Metadata includes the start time, each track's offset from a shared monotonic clock, sample rate, channel count, and actual duration. Files remain usable independently of the app.

At 48 kHz, mono microphone + stereo computer audio uses approximately **1 GB/hour**. There is no automatic deletion. The recorder checks free space every five seconds and stops below 250 MB. Deleted recordings go to the macOS Trash.

Metadata is written atomically and checkpointed during recording. If the app exits unexpectedly, the next launch marks the session interrupted and inspects any surviving audio. A damaged metadata file is reported without deleting its audio. Very early crashes before the first checkpoint may lose precise track offsets.
