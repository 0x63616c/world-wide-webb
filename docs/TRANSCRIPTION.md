# Local transcription: research and proposed design

Reviewed November 3, 2026. The initial use case is mostly English calls, transcribed after capture stops. Transcription is not implemented in Build 10; this document records the proposed next feature.

## Model choices

- **Parakeet Ultra through FluidAudio:** first candidate for English. The upstream model is a post-training of NVIDIA Parakeet v3; FluidAudio provides a Swift/Core ML conversion for Apple silicon. Both maintainers report improvements over v3. Treat those as published results, not measurements on Callkeep recordings. The model's CC BY 4.0 attribution must be included when distributing it. Sources: [upstream model and evaluation](https://huggingface.co/moondream/parakeet-ultra), [Core ML conversion and paired results](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/ASR/ParakeetUltra.md).
- **Whisper large-v3 Turbo:** an established alternative with broader language coverage. WhisperKit provides a native Apple silicon integration; an Intel implementation would need another adapter such as whisper.cpp. Argmax recommends Turbo variants for its Mac integration. Sources: [OpenAI model card](https://huggingface.co/openai/whisper-large-v3-turbo), [WhisperKit model selection](https://github.com/argmaxinc/argmax-oss-swift#model-selection).
- **Apple Speech:** SpeechAnalyzer and SpeechTranscriber provide on-device transcription on supported newer systems. macOS manages the language assets; the app should check actual availability and installed assets. This should appear as a system-provided option rather than as a downloadable third-party model. Source: [Apple's SpeechAnalyzer introduction](https://developer.apple.com/videos/play/wwdc2025/277/).
- **Qwen3-ASR 1.7B:** a further candidate, particularly for broader multilingual use. Its authors list 30 languages and 22 Chinese dialects. A compatible Mac inference adapter still needs evaluation; model weights alone are not a native app integration. Source: [Qwen model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B).

There is no measured winner for this app yet. Compare the same representative calls for names, accents, technical vocabulary, missed words and invented speech, plus processing time and peak memory. Published benchmark scores from different runtimes and datasets should not be ranked as if they were one controlled comparison.

## Model picker

Use a curated catalogue, initially Parakeet Ultra, Whisper Turbo and Apple Speech. Show download size, supported hardware/languages, installed state, download progress and removal controls. Pin external artifacts to known revisions and verify downloads. An arbitrary model file cannot run unless an installed engine supports its architecture and tokenizer.

Keep weights in local application support storage, outside the recording library and iCloud. Apple language assets stay system-managed. Offer one default model for automatic processing and a per-recording **Transcribe with…** action. Keep each model's result separately so users can compare text and elapsed processing time without losing the first transcript. Do not invent a quality score without a reference transcript.

## After-call queue

1. Finalize and close capture files before queueing transcription. Persist queued and failed jobs so closing the app does not lose work.
2. Process the microphone and system-audio tracks independently, preserving their start offsets. Merge timestamped segments with the source labels **You** and **Call audio**. More than one person in call audio needs a separate diarization step; two tracks do not identify every participant.
3. Write transcript results atomically beside the recording, including provider/model identity, revision where available, locale, generation time and processing duration. For Apple's system engine, record the OS build rather than pretending the weights can be pinned.
4. Coordinate transcription with migration so a recording cannot move while a worker is opening its files. Prefer completing local transcription before moving the finished folder, or use a coordinated snapshot. Pause background inference when another recording starts.
5. Results follow the recording's existing iCloud setting. Local inference means no ASR service receives the audio; it does not disable the user's separate iCloud storage preference.

## Apple Intelligence

Keep speech recognition and summarization as separate choices. Apple's public Speech APIs handle audio transcription. The on-device Foundation Models language model can then summarize the transcript, extract action items or generate a title. Long transcripts need an appropriate chunking strategy. Check availability and retain the original transcript; generated summaries may be wrong.

Use the explicit on-device model for the local feature. Apple's newer Foundation Models APIs also expose cloud-backed capabilities, which are a different product choice. Sources: [Apple's example combining speech transcription and a generated title](https://developer.apple.com/videos/play/wwdc2025/277/), [Foundation Models capabilities](https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models), [macOS 27 framework updates](https://developer.apple.com/documentation/updates/foundationmodels).
