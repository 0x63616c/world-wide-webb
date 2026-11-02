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

    func testArchiveMovesClosedAudioAndKeepsRenameAndDiscoveryWorking() throws {
        let store = try RecordingStore(root: root.appendingPathComponent("local"))
        store.archiveRoot = root.appendingPathComponent("cloud")
        var recording = Recording(title: "Cloud call", createdAt: Date(timeIntervalSince1970: 1700000000))
        try store.save(recording)
        let local = store.folder(for: recording)
        let audio = Data("audio bytes".utf8)
        try audio.write(to: local.appendingPathComponent("microphone.caf"))
        try store.archive(recording)
        XCTAssertTrue(FileManager.default.fileExists(atPath: local.path), "Active recordings must stay local")
        recording.state = .saved
        try store.save(recording)
        try store.archive(recording)
        XCTAssertFalse(FileManager.default.fileExists(atPath: local.path))
        XCTAssertEqual(try Data(contentsOf: store.folder(for: recording).appendingPathComponent("microphone.caf")), audio)
        XCTAssertEqual(try store.load(), [recording])
        recording.title = "Renamed in cloud"
        try store.save(recording)
        XCTAssertEqual(try store.load(), [recording])
    }
    func testArchiveFailurePreservesLocalFilesAndDoesNotOverwriteCloud() throws {
        let store = try RecordingStore(root: root.appendingPathComponent("local"))
        let cloud = root.appendingPathComponent("cloud")
        store.archiveRoot = cloud
        var recording = Recording(title: "Local"); recording.state = .interrupted
        try store.save(recording)
        let local = store.folder(for: recording)
        let destination = cloud.appendingPathComponent(recording.id.uuidString)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        try Data("existing".utf8).write(to: destination.appendingPathComponent("keep"))
        XCTAssertThrowsError(try store.archive(recording))
        XCTAssertTrue(FileManager.default.fileExists(atPath: local.appendingPathComponent("recording.json").path))
        XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("keep")), Data("existing".utf8))
        XCTAssertEqual(try store.load().first?.id, recording.id)
    }
    func testCloudSessionsAreNeverRecoveredAsLocalCrashes() throws {
        let cloud = root.appendingPathComponent("cloud")
        let cloudStore = try RecordingStore(root: cloud)
        let recording = Recording(title: "Other Mac")
        try cloudStore.save(recording)
        let store = try RecordingStore(root: root.appendingPathComponent("local"))
        store.archiveRoot = cloud
        XCTAssertEqual(try store.load(recover: true).first?.state, .recording)
    }
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
    func test44100CaptureResamplesWithoutPeriodicSilentGapsOrPitchChange() throws {
        let url = root.appendingPathComponent("resampled.caf")
        let destination = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2))
        let source = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
        let writer = TrackWriter(url: url, epoch: 100, format: destination)
        // Reproduce the FaceTime callback size and rate that the old code
        // mislabeled as 48 kHz, inserting 271/272 zero frames every callback.
        for block in 0..<32 {
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 3072))
            buffer.frameLength = 3072
            for channel in 0..<2 {
                for frame in 0..<3072 {
                    buffer.floatChannelData![channel][frame] = 0.5 * sin(Float(block * 3072 + frame) * 2 * .pi * 440 / 44100)
                }
            }
            writer.append(buffer, at: 100 + Double(block * 3072) / 44100)
        }
        let track = try XCTUnwrap(writer.finish())
        XCTAssertNil(writer.snapshot.error)
        XCTAssertEqual(track.sampleRate, 48000)
        XCTAssertEqual(track.duration, Double(32 * 3072) / 44100, accuracy: 0.002)
        let file = try AVAudioFile(forReading: url)
        let audio = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: UInt32(file.length)))
        try file.read(into: audio)
        let data = audio.floatChannelData![0]
        var silentRun = 0, longestSilence = 0, risingCrossings = 0
        for frame in 200..<Int(audio.frameLength) - 200 {
            silentRun = data[frame] == 0 ? silentRun + 1 : 0
            longestSilence = max(longestSilence, silentRun)
            if data[frame - 1] <= 0 && data[frame] > 0 { risingCrossings += 1 }
        }
        XCTAssertLessThan(longestSilence, 5)
        let frequency = Double(risingCrossings) / (Double(Int(audio.frameLength) - 400) / 48000)
        XCTAssertEqual(frequency, 440, accuracy: 1)
    }

    func testFormatChangeCanContinueInOneStableFile() throws {
        let url = root.appendingPathComponent("reconfigured.caf")
        let destination = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        let writer = TrackWriter(url: url, epoch: 100, format: destination)
        writer.append(try tone(frames: 4800), at: 100)
        let changedFormat = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1))
        let changed = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: changedFormat, frameCapacity: 4410))
        changed.frameLength = 4410
        for frame in 0..<4410 { changed.floatChannelData![0][frame] = 0.25 }
        writer.append(changed, at: 100.2)
        let track = try XCTUnwrap(writer.finish())
        XCTAssertNil(writer.snapshot.error)
        XCTAssertEqual(track.channels, 1)
        XCTAssertEqual(track.sampleRate, 48000)
        XCTAssertEqual(track.duration, 0.3, accuracy: 0.002)
        let file = try AVAudioFile(forReading: url)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 100))
        file.framePosition = 7000; try file.read(into: buffer)
        XCTAssertEqual(buffer.floatChannelData![0][0], 0)
        file.framePosition = 11000; try file.read(into: buffer)
        XCTAssertEqual(buffer.floatChannelData![0][0], 0.25, accuracy: 0.001)
    }

    func testMeterIncludesRightChannelAndClearsBetweenSamples() throws {
        let writer = TrackWriter(url: root.appendingPathComponent("stereo.caf"), epoch: 0)
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100))
        buffer.frameLength = 100
        for frame in 0..<100 { buffer.floatChannelData![0][frame] = 0; buffer.floatChannelData![1][frame] = 0.75 }
        writer.append(buffer, at: 0)
        _ = writer.finish()
        XCTAssertEqual(writer.takeLevel(), 0.75)
        XCTAssertEqual(writer.takeLevel(), 0)
    }

    func testResamplerResetsAcrossPassThroughFormatCycle() throws {
        let url = root.appendingPathComponent("cycle.caf")
        let target = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        let writer = TrackWriter(url: url, epoch: 0, format: target)
        for (index, rate) in [44100.0, 48000.0, 44100.0].enumerated() {
            let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1))
            let count = UInt32(rate / 10)
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count))
            buffer.frameLength = count
            for frame in 0..<Int(count) { buffer.floatChannelData![0][frame] = index == 0 ? 0.5 : 0 }
            writer.append(buffer, at: Double(index) * 0.1)
        }
        let track = try XCTUnwrap(writer.finish())
        XCTAssertNil(writer.snapshot.error)
        XCTAssertEqual(track.duration, 0.3, accuracy: 1 / 48000)
        let file = try AVAudioFile(forReading: url)
        file.framePosition = 9600
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4800))
        try file.read(into: buffer)
        XCTAssertEqual((0..<Int(buffer.frameLength)).map { abs(buffer.floatChannelData![0][$0]) }.max(), 0)
    }

    func testMonoUplinkDoesNotMixAuxiliaryChannelsIntoSpeech() throws {
        let url = root.appendingPathComponent("uplink.caf")
        let layout = try XCTUnwrap(AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | 3))
        let source = AVAudioFormat(standardFormatWithSampleRate: 48000, channelLayout: layout)
        let target = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        let writer = TrackWriter(url: url, epoch: 0, format: target, channelMap: [0])
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 4800))
        buffer.frameLength = 4800
        for frame in 0..<4800 {
            buffer.floatChannelData![0][frame] = 0.25
            buffer.floatChannelData![1][frame] = -0.75
            buffer.floatChannelData![2][frame] = 0.9
        }
        writer.append(buffer, at: 0)
        XCTAssertEqual(writer.finish()?.channels, 1)
        let file = try AVAudioFile(forReading: url)
        let result = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4800))
        try file.read(into: result)
        XCTAssertEqual(result.frameLength, 4800)
        XCTAssertEqual(result.floatChannelData![0][2400], 0.25, accuracy: 0.0001)
        XCTAssertNil(writer.snapshot.error)
    }

    private func importFixture(state: Recording.State = .saved) throws -> (Recording, URL) {
        let source = try RecordingStore(root: root.appendingPathComponent("source"))
        var recording = Recording(title: "Imported call", createdAt: Date(timeIntervalSince1970: 1700000000))
        recording.state = state
        try source.save(recording)
        let folder = source.folder(for: recording)
        let writer = TrackWriter(url: folder.appendingPathComponent("microphone.caf"), epoch: 100)
        writer.append(try tone(frames: 4800), at: 100.25)
        recording.microphone = try XCTUnwrap(writer.finish())
        recording.duration = 999 // Import recalculates actual audio duration.
        try source.save(recording)
        return (recording, folder)
    }
    func testImportCopiesAudioPreservesOriginalAndSkipsDuplicate() throws {
        let (recording, folder) = try importFixture()
        let store = try RecordingStore(root: root.appendingPathComponent("destination"))
        let imported = try XCTUnwrap(store.importRecordingFolder(at: folder))
        XCTAssertEqual(imported.id, recording.id)
        XCTAssertEqual(imported.duration, 0.35, accuracy: 0.001)
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("microphone.caf")), try Data(contentsOf: store.folder(for: imported).appendingPathComponent("microphone.caf")))
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.path))
        XCTAssertNil(try store.importRecordingFolder(at: folder))
        XCTAssertEqual(try store.load().count, 1)
    }
    func testImportAcceptsRecordingFolderOrContainingLibrary() throws {
        let (_, folder) = try importFixture()
        XCTAssertEqual(try RecordingStore.importCandidates(in: folder), [folder])
        XCTAssertEqual(try RecordingStore.importCandidates(in: folder.deletingLastPathComponent()).map { $0.resolvingSymlinksInPath().path }, [folder.resolvingSymlinksInPath().path])
        let empty = root.appendingPathComponent("empty")
        try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
        XCTAssertThrowsError(try RecordingStore.importCandidates(in: empty))
    }
    func testImportRejectsActiveSessionWithoutPublishingFiles() throws {
        let (_, folder) = try importFixture(state: .recording)
        let store = try RecordingStore(root: root.appendingPathComponent("destination"))
        XCTAssertThrowsError(try store.importRecordingFolder(at: folder))
        XCTAssertTrue(try store.load(recover: false).isEmpty)
    }
    func testImportRejectsEscapingAudioReferenceAndSymbolicLinks() throws {
        let (recording, folder) = try importFixture()
        let source = try RecordingStore(root: folder.deletingLastPathComponent())
        let store = try RecordingStore(root: root.appendingPathComponent("destination"))
        var unsafe = recording
        unsafe.microphone?.file = "../outside.caf"
        try source.save(unsafe)
        XCTAssertThrowsError(try store.importRecordingFolder(at: folder))
        try source.save(recording)
        let audio = folder.appendingPathComponent("microphone.caf")
        let outside = root.appendingPathComponent("outside.caf")
        try FileManager.default.moveItem(at: audio, to: outside)
        try FileManager.default.createSymbolicLink(at: audio, withDestinationURL: outside)
        XCTAssertThrowsError(try store.importRecordingFolder(at: folder))
        XCTAssertTrue(try store.load().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outside.path))
    }
    func testImportCleansStagingOnUnreadableAudio() throws {
        let (_, folder) = try importFixture()
        try Data("not audio".utf8).write(to: folder.appendingPathComponent("microphone.caf"))
        let store = try RecordingStore(root: root.appendingPathComponent("destination"))
        XCTAssertThrowsError(try store.importRecordingFolder(at: folder))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(at: store.root, includingPropertiesForKeys: nil).isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.path))
    }
    func testLegacyArchiveRemainsVisibleAndCanMoveToNativeDestination() throws {
        let (recording, legacyFolder) = try importFixture()
        let store = try RecordingStore(root: root.appendingPathComponent("local"))
        store.legacyArchiveRoots = [legacyFolder.deletingLastPathComponent()]
        XCTAssertEqual(try store.load(recover: false).first?.id, recording.id)
        store.archiveRoot = root.appendingPathComponent("native")
        try store.archive(recording)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyFolder.path))
        XCTAssertEqual(store.folder(for: recording).deletingLastPathComponent().path, store.archiveRoot?.path)
        XCTAssertEqual(try store.load(recover: false).count, 1)
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
