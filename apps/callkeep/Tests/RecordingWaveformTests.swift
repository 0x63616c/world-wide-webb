import XCTest
import AVFoundation
@testable import CallkeepCore

final class RecordingWaveformTests: XCTestCase {
    func testSourcesStaySeparateAndRespectOffsetsAndStereoChannels() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try write(root.appendingPathComponent("microphone.caf"), levels: [0.25])
        // Computer audio exists only in the right channel, starting a second later.
        try write(root.appendingPathComponent("system-audio.caf"), levels: [0, 0.75])
        var recording = Recording(title: "Waveform")
        recording.duration = 3
        recording.microphone = AudioTrack(file: "microphone.caf", startOffset: 0, duration: 1, sampleRate: 16000, channels: 1)
        recording.systemAudio = AudioTrack(file: "system-audio.caf", startOffset: 1, duration: 1, sampleRate: 16000, channels: 2)
        let waveform = try RecordingWaveform.read(recording, folder: root, bins: 6)
        XCTAssertEqual(waveform.microphone, [0.25, 0.25, 0, 0, 0, 0])
        XCTAssertEqual(waveform.systemAudio, [0, 0, 0.75, 0.75, 0, 0])
        recording.microphone = nil
        XCTAssertEqual(try RecordingWaveform.read(recording, folder: root, bins: 6).microphone, Array(repeating: 0, count: 6))
    }

    func testPeaksIncludeBriefSoundBetweenTheOldSampleWindows() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16000)!
        buffer.frameLength = 16000
        for frame in 0..<16000 { buffer.floatChannelData![0][frame] = frame == 8000 ? 0.5 : 0 }
        do { let file = try AVAudioFile(forWriting: root.appendingPathComponent("microphone.caf"), settings: format.settings); try file.write(from: buffer) }
        var recording = Recording(title: "Brief speech"); recording.duration = 1
        recording.microphone = AudioTrack(file: "microphone.caf", startOffset: 0, duration: 1, sampleRate: 16000, channels: 1)
        XCTAssertEqual(try RecordingWaveform.read(recording, folder: root, bins: 1).microphone, [0.5])
    }

    private func write(_ url: URL, levels: [Float]) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: AVAudioChannelCount(levels.count))!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16000)!
        buffer.frameLength = 16000
        for (channel, level) in levels.enumerated() {
            for frame in 0..<16000 { buffer.floatChannelData![channel][frame] = level }
        }
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
    }
}
