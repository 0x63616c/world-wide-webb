import XCTest
import AVFoundation
@testable import CallkeepCore

final class TranscriptionTests: XCTestCase {
    func testOverallProgressIncludesBothTracksAndResumedChunks() throws {
        var recording = Recording(title: "Progress")
        recording.microphone = AudioTrack(file: "mic.caf", startOffset: 0, duration: 60, sampleRate: 16000, channels: 1)
        recording.systemAudio = AudioTrack(file: "call.caf", startOffset: 10, duration: 40, sampleRate: 16000, channels: 1)
        XCTAssertEqual(try XCTUnwrap(TranscriptionAudio.progress(recording: recording, nextChunks: [:])), 0)
        XCTAssertEqual(try XCTUnwrap(TranscriptionAudio.progress(recording: recording, nextChunks: [.microphone: 3])), 0.6, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(TranscriptionAudio.progress(recording: recording, nextChunks: [.microphone: 3, .systemAudio: 1])), 0.85, accuracy: 0.0001)
        XCTAssertEqual(TranscriptionAudio.progress(recording: recording, nextChunks: [.microphone: 100, .systemAudio: 100]), 1)
        recording.systemAudio = nil
        XCTAssertEqual(TranscriptionAudio.progress(recording: recording, nextChunks: [.microphone: -1]), 0)
        recording.microphone = nil
        XCTAssertNil(TranscriptionAudio.progress(recording: recording, nextChunks: [:]))
    }
    func temporaryFolder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        return folder
    }
    func testQueuePreservesChunkProgressAndFailuresAcrossRestart() throws {
        let file = try temporaryFolder().appendingPathComponent("queue.json")
        var job = TranscriptionJob(recordingID: UUID(), modelID: "parakeet-ultra")
        job.nextChunks[.microphone] = 3
        job.segments = [TranscriptSegment(source: .microphone, start: 52, end: 55, text: "Saved progress")]
        job.state = .failed; job.error = "Missing track"
        try TranscriptionQueueFile.save([job], to: file)
        XCTAssertEqual(try TranscriptionQueueFile.load(file), [job])
        XCTAssertEqual(try TranscriptionQueueFile.load(file).first?.resultID, job.resultID)
    }
    func testTranscriptsKeepSeparateModelRunsAndTimelineOffsets() throws {
        let folder = try temporaryFolder()
        let record = Recording(title: "Test")
        try JSONEncoder().encode(record).write(to: folder.appendingPathComponent("recording.json"))
        let track = AudioTrack(file: "call.caf", startOffset: 2.5, duration: 40, sampleRate: 16000, channels: 1)
        let segment = try XCTUnwrap(TranscriptionAudio.aligned(text: " Other voice ", source: .systemAudio,
                                                           start: 1, end: 20, chunk: 1, track: track))
        XCTAssertEqual(segment.start, 28.5)
        XCTAssertEqual(segment.end, 42.5) // Clamp the final chunk to track length.
        XCTAssertNil(TranscriptionAudio.aligned(text: "Out of bounds", source: .systemAudio, start: 18, end: 20, chunk: 1, track: track))
        let voice = TranscriptSegment(source: .microphone, start: 1, end: 2, text: "Hello")
        let first = Transcript(recordingID: record.id, modelID: "one", modelName: "One", revision: "pin", processingSeconds: 1, segments: [segment, voice])
        let second = Transcript(recordingID: record.id, modelID: "two", modelName: "Two", revision: "pin", processingSeconds: 2, segments: [voice])
        try TranscriptFiles.save(first, folder: folder); try TranscriptFiles.save(second, folder: folder)
        // Repeating completion after a crash replaces only that run, rather than duplicating it.
        try TranscriptFiles.save(first, folder: folder)
        let loaded = try TranscriptFiles.load(folder: folder)
        XCTAssertEqual(loaded.count, 2)
        XCTAssertEqual(Set(loaded.map(\.modelID)), ["one", "two"])
        XCTAssertEqual(first.segments.first, voice)
        XCTAssertTrue(first.plainText.contains("[0:28] Call audio: Other voice"))
    }
    func testSavingCannotRecreateDeletedRecording() throws {
        let folder = try temporaryFolder().appendingPathComponent("missing")
        let result = Transcript(recordingID: UUID(), modelID: "one", modelName: "One", revision: "pin", processingSeconds: 1, segments: [])
        XCTAssertThrowsError(try TranscriptFiles.save(result, folder: folder))
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.path))
    }
    func testBoundedStereoDownmixAndSilence() throws {
        let folder = try temporaryFolder()
        let url = folder.appendingPathComponent("stereo.caf")
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48000)!
        buffer.frameLength = 48000
        buffer.floatChannelData![0].initialize(repeating: 0, count: 48000)
        buffer.floatChannelData![1].initialize(repeating: 0.5, count: 48000)
        do { let file = try AVAudioFile(forWriting: url, settings: format.settings); try file.write(from: buffer) }
        let samples = try TranscriptionAudio.read(url: url, chunk: 0)
        XCTAssertEqual(Double(samples.count), 16000, accuracy: 32)
        XCTAssertEqual(samples[8000], 0.25, accuracy: 0.001)
        XCTAssertFalse(TranscriptionAudio.isSilent(samples))
        XCTAssertTrue(try TranscriptionAudio.read(url: url, chunk: 1).isEmpty)
        XCTAssertTrue(TranscriptionAudio.isSilent([0, 0.000001]))
    }
}
