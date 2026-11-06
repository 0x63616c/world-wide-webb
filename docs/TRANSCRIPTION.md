# Local transcription

After transcription, Callkeep can suggest a title using the on-device Apple Intelligence model and recent non-default recording titles as style examples. The suggestion is stored with the recording, including when that recording is moved to iCloud Drive. Accept, edit, or dismiss it in the recording detail; existing custom titles are not replaced. Disable suggestions under Settings → Title suggestions. This feature requires macOS 26 or later and an available Apple Intelligence on-device model. Voice recognition is not used.

Callkeep transcribes each finished call on this Mac, after audio capture has closed its files. This feature requires Apple silicon and macOS 15 or later. Recording and playback still support Intel.

## Choose and download a model

Open **Settings → Transcription**. Leave **Transcribe after recording** enabled, choose a default, then download it:

- **Parakeet Ultra** (632 MB): the default, with support for 25 European languages and fast Core ML inference through FluidAudio.
- **Whisper Turbo** (629 MB): OpenAI large-v3 Turbo, compressed for Core ML by Argmax. This integration is configured for English transcription.

The picker shows progress and download speed. Downloads are optional; if a queued recording needs a missing model, the transcript panel links back to Settings. Canceling a download preserves verified files for the next attempt. Remove asks for confirmation, then moves an installed model to Trash and keeps existing transcripts. The confirmation explains that the model must be downloaded again.

Model files stay under `~/Library/Application Support/Callkeep/Models`, outside iCloud. The catalogue pins Hugging Face revisions and checks every file's size and SHA-256 (LFS) or Git blob ID. No model discovery, audio upload or remote transcription happens during inference. The Whisper adapter loads its tokenizer locally and fails if it cannot be read, without a network fallback. Credits and license texts are available in Settings and bundled in the app.

Sources: [Parakeet Ultra](https://huggingface.co/moondream/parakeet-ultra), [FluidInference conversion](https://huggingface.co/FluidInference/parakeet-ultra-coreml), [Whisper Turbo](https://huggingface.co/openai/whisper-large-v3-turbo), [WhisperKit](https://github.com/argmaxinc/argmax-oss-swift). These are supported options, not a claim of a measured accuracy winner on your calls.

## Read and compare transcripts

Open a recording. Its transcript appears below the playback controls, highlights the current phrases and follows playback automatically. Existing recordings can be transcribed manually with **Transcribe**, or **Transcribe with…** to choose another model. Each run is retained separately; the result picker switches between runs without replacing the first transcript. **Copy** copies timestamped text. Click a transcript row to seek the audio to that phrase.

The microphone is labeled **You**, and computer audio is labeled **Call audio**, using the same purple and teal colors as playback. Multiple people within call audio are not individually identified. Overlapping voices, accents, names, quiet speech and chunk boundaries can affect recognition. Keep the original audio as the reference.

macOS notifications announce completed transcripts when **Notify when a transcript is ready** is enabled. Allow the permission prompt to receive them. Clicking the notification opens the recording; the alert text does not include the recording’s title or transcript.

## Queue and storage

The queue is persisted in local Application Support. It reads bounded 25-second chunks, downmixes all channels and converts to 16 kHz. Completed chunks are checkpointed, track start offsets are added to segment times, and segments are merged chronologically. Digital silence is skipped. New capture requests cancel background processing; completed chunks resume after capture ends or the app next opens. An in-flight model operation may finish before cancellation takes effect. Failed jobs have Retry and Cancel controls.

Transcription waits until the library's iCloud location has been resolved. Callkeep's own iCloud migrations wait while transcription is running; an active job's recording cannot be trashed until processing is canceled. A completed result is written atomically under the recording's `Transcripts` folder. Its metadata includes the provider/model revision, creation time and inference time. Repeating the last completion after a crash uses the same result ID. Moving or importing a recording preserves its transcripts.

Finished results follow **Settings → Storage**, including iCloud syncing if enabled. Local ASR means no transcription service receives the audio; the separate iCloud setting continues to control storage.

## Apple Speech and Apple Intelligence

Apple Speech, additional models and automatic summaries are not included in this first model picker. The engine interface supports additional adapters without changing recording storage. Apple's on-device Speech APIs are a future system-managed option; Foundation Models can separately summarize text or extract action items. These should remain separate from recognition and retain the original transcript.

Sources: [Apple SpeechAnalyzer](https://developer.apple.com/videos/play/wwdc2025/277/), [Foundation Models](https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models).

## Validation

Both downloaded models recognized a generated English speech fixture locally. The native app produced a timestamped two-track transcript with the correct source labels and offsets. This is a functional test, not an accuracy benchmark on real calls. Automated tests cover queue persistence, pause/resume, opt-out behavior, model integrity checks, bounded stereo conversion, result preservation and deleted-recording protection. Set `CALLKEEP_ASR_SMOKE_ROOT` when running the optional downloaded-engine XCTest; ordinary CI does not download weights.
