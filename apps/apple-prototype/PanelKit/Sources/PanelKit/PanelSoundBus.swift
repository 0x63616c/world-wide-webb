import AVFoundation

/// Named, device-volume cues shared by native panel features.
public enum PanelSoundCue: String, Sendable { case timerTick, timerFinished }

@MainActor public protocol PanelSoundPlaying: AnyObject {
    func play(_ cue: PanelSoundCue)
    func stop()
}

@MainActor public final class PanelSoundBus: PanelSoundPlaying {
    public static let shared = PanelSoundBus()
    private var players: [PanelSoundCue: AVAudioPlayer] = [:]
    private init() {}

    public func play(_ cue: PanelSoundCue) {
        if players[cue] == nil,
           let url = Bundle.module.url(forResource: cue.rawValue, withExtension: "wav"),
           let player = try? AVAudioPlayer(contentsOf: url) {
            player.prepareToPlay()
            players[cue] = player
        }
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        players[cue]?.currentTime = 0
        players[cue]?.play()
    }
    public func stop() { for player in players.values { player.stop() } }
}
