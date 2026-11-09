// Exercise the actual AVAudioPlayer volumes with disposable silent tracks.
import AVFoundation
import CallkeepCore

@main
struct PlaybackHarness {
    struct Failure: Error { let message: String }
    @MainActor static func main() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16000)!
        buffer.frameLength = 16000
        buffer.floatChannelData![0].initialize(repeating: 0, count: 16000)
        // Different filenames prove routing uses track identity, not a hardcoded name.
        for name in ["voice.caf", "call.caf"] {
            let file = try AVAudioFile(forWriting: folder.appendingPathComponent(name), settings: format.settings)
            try file.write(from: buffer)
        }
        var recording = Recording(title: "Playback test")
        recording.duration = 1
        recording.microphone = RecordingStore.inspect(folder.appendingPathComponent("voice.caf"), offset: 0)
        recording.systemAudio = RecordingStore.inspect(folder.appendingPathComponent("call.caf"), offset: 0.1)
        let playback = Playback()
        // Read the real players without adding a test-only production interface.
        func volumes() -> [Float] {
            let players = Mirror(reflecting: playback).children.first { $0.label == "_players" }!.value
                as! [(AVAudioPlayer, AudioTrack, Bool)]
            return players.map { $0.0.volume }
        }
        func require(_ condition: Bool, _ message: String) throws {
            if !condition { throw Failure(message: message) }
        }
        try playback.load(recording, folder: folder)
        try require(volumes() == [1, 1], "Both tracks start audible")
        playback.seek(0.2)
        playback.play()
        playback.microphoneEnabled = false
        try require(volumes() == [0, 1] && playback.isPlaying, "Muting you must leave call audio playing")
        playback.systemAudioEnabled = false
        try require(volumes() == [0, 0] && playback.isPlaying, "Both tracks can be muted independently")
        playback.microphoneEnabled = true
        try require(volumes() == [1, 0], "You can be restored while call audio stays muted")
        playback.seek(0.5)
        playback.pause()
        try require(volumes() == [1, 0] && playback.position >= 0.5, "Seeking and pausing retain track selection")
        try playback.load(recording, folder: folder)
        try require(volumes() == [1, 0], "Reloading the same recording retains selection")
        var next = Recording(title: "Next recording")
        next.duration = recording.duration
        next.systemAudio = recording.systemAudio
        try playback.load(next, folder: folder)
        try require(volumes() == [1] && playback.microphoneEnabled && playback.systemAudioEnabled,
                    "A different recording resets both tracks, including a single-track recording")
        playback.systemAudioEnabled = false
        try require(volumes() == [0], "A recording without a microphone still routes call audio correctly")
        playback.stop()
        print("Playback track toggle checks passed")
    }
}
