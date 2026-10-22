import XCTest
import AVFoundation
@testable import CallkeepCore

final class RecordingStoreTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    func testSavedRecordingSurvivesReopeningAndRenaming() throws {
        let store = try RecordingStore(root: root)
        var recording = Recording(title: "Project call")
        recording.state = .saved; recording.duration = 72.5
        recording.microphone = AudioTrack(file: "microphone.caf", startOffset: 0.14, duration: 72, sampleRate: 48000, channels: 1)
        try store.save(recording)
        let reopened = try RecordingStore(root: root)
        var loaded = try XCTUnwrap(reopened.load().first)
        XCTAssertEqual(loaded.id, recording.id)
        XCTAssertEqual(loaded.microphone?.startOffset, 0.14)
        loaded.title = "Renamed call"; try reopened.save(loaded)
        XCTAssertEqual(try store.load().first?.title, "Renamed call")
        XCTAssertEqual(try store.load().count, 1)
    }
    func testInterruptedRecordingRecoversAudioFromDisk() throws {
        let store = try RecordingStore(root: root)
        let recording = Recording(title: "Unfinished")
        try store.save(recording)
        let writer = TrackWriter(url: store.folder(for: recording).appendingPathComponent("microphone.caf"), epoch: 100)
        writer.append(try tone(frames: 48000), at: 100.25)
        let track = try XCTUnwrap(writer.finish())
        XCTAssertEqual(track.duration, 1, accuracy: 0.001)
        XCTAssertEqual(track.startOffset, 0.25, accuracy: 0.001)
        let recovered = try XCTUnwrap(store.load().first)
        XCTAssertEqual(recovered.state, .interrupted)
        XCTAssertEqual(recovered.microphone?.duration ?? 0, 1, accuracy: 0.001)
        XCTAssertNil(recovered.systemAudio)
        XCTAssertEqual(try store.load().first?.state, .interrupted)
    }
    func testTrackWriterPreservesSamplesAndTiming() throws {
        let url = root.appendingPathComponent("test.caf")
        let writer = TrackWriter(url: url, epoch: 500)
        writer.append(try tone(frames: 4800), at: 500.5)
        writer.append(try tone(frames: 4800), at: 500.6)
        let track = try XCTUnwrap(writer.finish())
        XCTAssertEqual(track.startOffset, 0.5)
        XCTAssertEqual(track.duration, 0.2, accuracy: 0.0001)
        let audio = try AVAudioFile(forReading: url)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: 9600))
        try audio.read(into: buffer)
        XCTAssertEqual(buffer.frameLength, 9600)
        let samples = try XCTUnwrap(buffer.floatChannelData?[0])
        XCTAssertGreaterThan((0..<9600).map { abs(samples[$0]) }.max() ?? 0, 0.49)
        XCTAssertNil(writer.snapshot.error)
    }
    func testCorruptMetadataDoesNotHideValidRecordingOrDeleteAudio() throws {
        let store = try RecordingStore(root: root)
        var good = Recording(title: "Good"); good.state = .saved; try store.save(good)
        let bad = root.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: bad, withIntermediateDirectories: true)
        try Data("bad json".utf8).write(to: bad.appendingPathComponent("recording.json"))
        XCTAssertEqual(try store.load().count, 1)
        XCTAssertEqual(store.warnings.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: bad.path))
    }
    func testLoadWithoutRecoveryDoesNotFinalizeActiveRecording() throws {
        let store = try RecordingStore(root: root)
        try store.save(Recording(title: "Active"))
        XCTAssertEqual(try store.load(recover: false).first?.state, .recording)
    }
    func testWriteFailureIsReported() throws {
        let writer = TrackWriter(url: root.appendingPathComponent("missing/test.caf"), epoch: 0)
        writer.append(try tone(frames: 100), at: 0)
        XCTAssertNil(writer.finish())
        XCTAssertNotNil(writer.snapshot.error)
    }
    func testFormatChangeIsReportedInsteadOfSilentlyLosingAudio() throws {
        let writer = TrackWriter(url: root.appendingPathComponent("format.caf"), epoch: 0)
        writer.append(try tone(frames: 100), at: 0)
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)); buffer.frameLength = 100
        writer.append(buffer, at: 0.1)
        XCTAssertNotNil(writer.finish())
        XCTAssertNotNil(writer.snapshot.error)
    }
    func testSilentCallbackGapsKeepTheTimelineAligned() throws {
        let url = root.appendingPathComponent("gaps.caf")
        let writer = TrackWriter(url: url, epoch: 100)
        writer.append(try tone(frames: 4800), at: 100.5)
        writer.append(try tone(frames: 4800), at: 101.5)
        let track = try XCTUnwrap(writer.finish())
        XCTAssertEqual(track.startOffset, 0.5)
        XCTAssertEqual(track.duration, 1.1, accuracy: 0.0001)
        let file = try AVAudioFile(forReading: url)
        file.framePosition = 10000
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1000))
        try file.read(into: buffer)
        XCTAssertEqual((0..<1000).map { abs(buffer.floatChannelData![0][$0]) }.max(), 0)
        file.framePosition = 48000
        try file.read(into: buffer)
        XCTAssertGreaterThan((0..<1000).map { abs(buffer.floatChannelData![0][$0]) }.max() ?? 0, 0.49)
    }
    private func tone(frames: UInt32) throws -> AVAudioPCMBuffer {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)); buffer.frameLength = frames
        for i in 0..<Int(frames) { buffer.floatChannelData![0][i] = 0.5 * sin(Float(i) * 2 * .pi * 440 / 48000) }
        return buffer
    }
}

final class ShortcutTests: XCTestCase {
    func testHyperAndModifierLabels() {
        XCTAssertEqual(Shortcut.default.label, "HYPR R")
        XCTAssertEqual(Shortcut(keyCode: 40, modifiers: Shortcut.command | Shortcut.shift, key: "K").label, "⇧⌘K")
        XCTAssertEqual(Shortcut(keyCode: 8, modifiers: Shortcut.control | Shortcut.option, key: "C").label, "⌃⌥C")
        XCTAssertFalse(Shortcut(keyCode: 15, modifiers: 0, key: "R").isValid)
        XCTAssertFalse(Shortcut(keyCode: 15, modifiers: Shortcut.shift, key: "R").isValid)
    }
    func testShortcutRoundTrip() throws {
        let shortcut = Shortcut(keyCode: 40, modifiers: Shortcut.command | Shortcut.option, key: "K")
        XCTAssertEqual(try JSONDecoder().decode(Shortcut.self, from: JSONEncoder().encode(shortcut)), shortcut)
    }
}
