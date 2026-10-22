import AVFoundation
import Observation
import CallkeepCore

@MainActor @Observable
final class Playback {
    var isPlaying = false
    var position: TimeInterval = 0
    var duration: TimeInterval = 0
    var source = Source.both
    enum Source: String, CaseIterable { case both = "Both tracks", microphone = "Microphone", system = "Computer audio" }
    private var players: [(AVAudioPlayer, AudioTrack)] = []
    private var timer: Timer?
    private var basePosition: TimeInterval = 0
    private var started: TimeInterval = 0
    private var record: Recording?
    private var folder: URL?
    func load(_ recording: Recording, folder: URL) throws {
        stop(); self.record = recording; self.folder = folder; duration = recording.duration
        for track in [recording.microphone, recording.systemAudio].compactMap({ $0 }) {
            let player = try AVAudioPlayer(contentsOf: folder.appendingPathComponent(track.file))
            player.prepareToPlay(); players.append((player, track))
        }
        applyVolumes()
    }
    func changeSource(_ source: Source) { self.source = source; applyVolumes() }
    private func applyVolumes() {
        for (player, track) in players {
            player.volume = source == .both || (source == .microphone && track.file == "microphone.caf") || (source == .system && track.file == "system-audio.caf") ? 1 : 0
        }
    }
    func toggle() { isPlaying ? pause() : play() }
    func play() {
        guard !players.isEmpty else { return }
        if position >= duration { position = 0 }
        basePosition = position; started = ProcessInfo.processInfo.systemUptime
        for (player, track) in players {
            player.currentTime = max(0, position - track.startOffset)
            if position < track.startOffset + track.duration { player.play(atTime: player.deviceCurrentTime + max(0, track.startOffset - position) + 0.05) }
        }
        isPlaying = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isPlaying else { return }
                self.position = min(self.duration, self.basePosition + ProcessInfo.processInfo.systemUptime - self.started)
                if self.position >= self.duration { self.pause() }
            }
        }
    }
    func pause() { players.forEach { $0.0.pause() }; timer?.invalidate(); timer = nil; isPlaying = false }
    func seek(_ time: TimeInterval) { let resume = isPlaying; pause(); position = max(0, min(time, duration)); if resume { play() } }
    func stop() { pause(); players = []; position = 0; duration = 0 }
}
