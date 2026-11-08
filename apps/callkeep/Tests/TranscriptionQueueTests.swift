import XCTest
import AVFoundation
import CryptoKit
import LocalTranscription
@testable import CallkeepCore

private actor StubSpeechEngine: SpeechEngine {
    var calls = 0
    func load(id: String, folder: URL) async throws {}
    func unload() async {}
    func transcribe(_ samples: [Float]) async throws -> [SpeechSegment] {
        calls += 1
        try await Task.sleep(for: .milliseconds(15))
        return [SpeechSegment(start: 0.2, end: 1, text: "Recognized phrase")]
    }
}
final class TranscriptionQueueTests: XCTestCase {
    func testSpeakerModelSmokeWhenRequested() async throws {
        guard let model = ProcessInfo.processInfo.environment["CALLKEEP_SPEAKER_MODEL"],
              let audio = ProcessInfo.processInfo.environment["CALLKEEP_SPEAKER_AUDIO"] else {
            throw XCTSkip("Set CALLKEEP_SPEAKER_MODEL and CALLKEEP_SPEAKER_AUDIO for a diarization smoke test")
        }
        let result = try await LocalSpeakerEngine.analyze(audio: URL(fileURLWithPath: audio), modelFolder: URL(fileURLWithPath: model), offset: 0)
        XCTAssertFalse(result.turns.isEmpty)
        XCTAssertFalse(result.embeddings.isEmpty)
        XCTAssertTrue(result.embeddings.values.allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isFinite) })
        if let same = ProcessInfo.processInfo.environment["CALLKEEP_SPEAKER_AUDIO_SAME"],
           let different = ProcessInfo.processInfo.environment["CALLKEEP_SPEAKER_AUDIO_DIFFERENT"] {
            let modelURL = URL(fileURLWithPath: model)
            let a = try XCTUnwrap(result.embeddings.values.first)
            let sameResult = try await LocalSpeakerEngine.analyze(audio: URL(fileURLWithPath: same), modelFolder: modelURL, offset: 0)
            let differentResult = try await LocalSpeakerEngine.analyze(audio: URL(fileURLWithPath: different), modelFolder: modelURL, offset: 0)
            let b = try XCTUnwrap(sameResult.embeddings.values.first)
            let c = try XCTUnwrap(differentResult.embeddings.values.first)
            let sameScore = try XCTUnwrap(VoiceMatching.similarity(a, b))
            let otherScore = try XCTUnwrap(VoiceMatching.similarity(a, c))
            print("Synthetic voice similarity: same=\(sameScore), different=\(otherScore)")
            XCTAssertGreaterThan(sameScore, otherScore)
        }
        if let multi = ProcessInfo.processInfo.environment["CALLKEEP_SPEAKER_AUDIO_MULTI"] {
            let multiResult = try await LocalSpeakerEngine.analyze(audio: URL(fileURLWithPath: multi), modelFolder: URL(fileURLWithPath: model), offset: 2)
            XCTAssertGreaterThanOrEqual(multiResult.embeddings.count, 2)
            XCTAssertTrue(multiResult.turns.allSatisfy { $0.start >= 2 && $0.end > $0.start })
        }
    }
    @MainActor func testPausedQueueResumesAndKeepsModelResults() async throws {
        guard TranscriptionModel.supported else { throw XCTSkip("Apple silicon transcription") }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let suite = "callkeep-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = TranscriptionModel.all[0]
        let modelFolder = root.appendingPathComponent("Models/" + model.id)
        try FileManager.default.createDirectory(at: modelFolder, withIntermediateDirectories: true)
        let payload = Data("verified model fixture".utf8)
        try payload.write(to: modelFolder.appendingPathComponent("weights"))
        try model.revision.write(to: modelFolder.appendingPathComponent(".installed"), atomically: true, encoding: .utf8)
        let manifest = root.appendingPathComponent("manifest.json")
        let file = ModelDownloadFile(repo: "test", revision: "pin", path: "weights", localPath: "weights", size: Int64(payload.count),
                                     sha256: SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined(), gitSHA: nil)
        try JSONEncoder().encode([model.id: [file]]).write(to: manifest)
        var record = Recording(title: "Fixture")
        record.state = .saved; record.duration = 1.2
        record.microphone = AudioTrack(file: "voice.caf", startOffset: 0, duration: 1, sampleRate: 16000, channels: 1)
        record.systemAudio = AudioTrack(file: "call.caf", startOffset: 0.2, duration: 1, sampleRate: 16000, channels: 1)
        let folder = root.appendingPathComponent(record.id.uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(record).write(to: folder.appendingPathComponent("recording.json"))
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16000)!
        buffer.frameLength = 16000; buffer.floatChannelData![0].initialize(repeating: 0.1, count: 16000)
        for name in ["voice.caf", "call.caf"] {
            let audio = try AVAudioFile(forWriting: folder.appendingPathComponent(name), settings: format.settings)
            try audio.write(from: buffer)
        }
        let engine = StubSpeechEngine()
        let controller = TranscriptionController(root: root, defaults: defaults, engine: engine, manifestURL: manifest)
        var completed: [UUID] = []
        var completedTranscripts: [Transcript] = []
        var permissionRequests = 0
        controller.requestNotifications = { permissionRequests += 1 }
        controller.didComplete = { completed.append($0) }
        controller.transcriptCompleted = { completedTranscripts.append($0) }
        controller.recording = { _ in (record, folder) }
        controller.canRun = { true }
        controller.setSuspended(true)
        controller.enqueue(record, automatic: true)
        XCTAssertEqual(controller.jobs.count, 1)
        XCTAssertFalse(controller.isRunning)
        XCTAssertEqual(try TranscriptionQueueFile.load(root.appendingPathComponent("Transcription/queue.json")).count, 1)
        controller.setSuspended(false)
        for _ in 0..<100 {
            if await engine.calls > 0 { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        controller.setSuspended(true)
        for _ in 0..<100 where controller.isRunning { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertEqual(controller.jobs.first?.state, .queued, "Pausing an in-flight chunk must not fail the job")
        controller.setSuspended(false)
        for _ in 0..<200 where controller.isRunning || !controller.jobs.isEmpty {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(controller.jobs.isEmpty)
        XCTAssertFalse(controller.isRunning)
        let result = try XCTUnwrap(TranscriptFiles.load(folder: folder).first)
        XCTAssertEqual(result.segments.count, 2)
        XCTAssertEqual(result.segments[0].source, .microphone)
        XCTAssertEqual(result.segments[1].start, 0.4, accuracy: 0.001)
        let calls = await engine.calls
        XCTAssertEqual(calls, 3)
        XCTAssertEqual(completed, [record.id])
        XCTAssertEqual(completedTranscripts.map(\.id), [result.id])
        XCTAssertEqual(permissionRequests, 1)
        controller.automatic = false
        controller.enqueue(record, automatic: true)
        XCTAssertTrue(controller.jobs.isEmpty)
    }
    func testModelVerifierRejectsModifiedOrTruncatedFile() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let data = Data("test".utf8)
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let file = ModelDownloadFile(repo: "repo", revision: "pin", path: "x", localPath: "x", size: 4, sha256: hash, gitSHA: nil)
        try data.write(to: url); XCTAssertTrue(try file.verify(url))
        try Data("nope".utf8).write(to: url); XCTAssertFalse(try file.verify(url))
        try Data("no".utf8).write(to: url); XCTAssertFalse(try file.verify(url))
    }
    func testRealDownloadedEnginesOnGeneratedSpeechWhenRequested() async throws {
        guard let base = ProcessInfo.processInfo.environment["CALLKEEP_ASR_SMOKE_ROOT"] else {
            throw XCTSkip("Set CALLKEEP_ASR_SMOKE_ROOT to verify downloaded models on synthetic speech")
        }
        let root = URL(fileURLWithPath: base)
        let audio = try TranscriptionAudio.read(url: root.appendingPathComponent("speech.wav"), chunk: 0)
        for id in ["parakeet-ultra", "whisper-turbo"] {
            let engine = LocalSpeechEngine()
            try await engine.load(id: id, folder: root.appendingPathComponent("Models/" + id))
            let result = try await engine.transcribe(audio)
            let text = result.map(\.text).joined(separator: " ").lowercased()
            print("\(id) synthetic speech: \(text)")
            XCTAssertTrue(text.contains("friday"), "\(id) should recognize the generated speech")
            XCTAssertTrue(text.contains("review"))
            await engine.unload()
        }
    }
}
