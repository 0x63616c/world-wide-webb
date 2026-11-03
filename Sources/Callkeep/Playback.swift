import AVFoundation
import Observation
import CallkeepCore

@MainActor @Observable
final class Playback {
    var isPlaying = false
    var position: TimeInterval = 0
    var duration: TimeInterval = 0
    var microphoneEnabled = true { didSet { applyVolumes() } }
    var systemAudioEnabled = true { didSet { applyVolumes() } }
    private var players: [(AVAudioPlayer, AudioTrack, Bool)] = []
    private var timer: Timer?
    private var basePosition: TimeInterval = 0
    private var started: TimeInterval = 0
    private var record: Recording?
    private var folder: URL?
    var currentPosition: TimeInterval {
        guard isPlaying else { return position }
        return min(duration, basePosition + max(0, ProcessInfo.processInfo.systemUptime - started))
    }
    func load(_ recording: Recording, folder: URL) throws {
        stop()
        if record?.id != recording.id {
            microphoneEnabled = true
            systemAudioEnabled = true
        }
        self.record = recording; self.folder = folder; duration = recording.duration
        for (optionalTrack, isMicrophone) in [(recording.microphone, true), (recording.systemAudio, false)] {
            guard let track = optionalTrack else { continue }
            let player = try AVAudioPlayer(contentsOf: folder.appendingPathComponent(track.file))
            player.prepareToPlay(); players.append((player, track, isMicrophone))
        }
        applyVolumes()
    }
    private func applyVolumes() {
        for (player, _, isMicrophone) in players {
            player.volume = (isMicrophone ? microphoneEnabled : systemAudioEnabled) ? 1 : 0
        }
    }
    func toggle() { isPlaying ? pause() : play() }
    func play() {
        guard !players.isEmpty, !isPlaying, duration > 0 else { return }
        if position >= duration { position = 0 }
        // Keep the visual clock aligned with the scheduled audio start.
        let delay = 0.05
        basePosition = position; started = ProcessInfo.processInfo.systemUptime + delay
        let deviceStart = players[0].0.deviceCurrentTime + delay
        for (player, track, _) in players {
            player.currentTime = max(0, position - track.startOffset)
            if position < track.startOffset + track.duration { player.play(atTime: deviceStart + max(0, track.startOffset - position)) }
        }
        isPlaying = true
        // Only completion needs polling; the timeline renders from the clock at display cadence.
        timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isPlaying else { return }
                if self.currentPosition >= self.duration { self.pause() }
            }
        }
        if let timer { RunLoop.main.add(timer, forMode: .common) }
    }
    func pause() {
        position = currentPosition
        players.forEach { $0.0.pause() }; timer?.invalidate(); timer = nil; isPlaying = false
    }
    func seek(_ time: TimeInterval) {
        let resume = isPlaying
        pause(); position = max(0, min(time, duration))
        if resume && position < duration { play() }
    }
    func stop() { pause(); players = []; position = 0; duration = 0 }
}
