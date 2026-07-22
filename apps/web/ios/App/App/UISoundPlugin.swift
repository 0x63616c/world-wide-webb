import AVFoundation
import Capacitor
import Foundation
import os.log

/**
 * UISound , plays one of iOS's own UISounds recordings through the panel's
 * shared audio session.
 *
 * The photo booth's shutter is iOS's real camera shutter
 * (/System/Library/Audio/UISounds/photoShutter.caf): a recording everyone reads
 * as "photo taken", with nothing bundled and no licence to honour.
 *
 * It used to be played with `AudioServicesPlaySystemSound`, which is simpler ,
 * but system-sound playback ignores the AVAudioSession category BY DESIGN and
 * always obeys the ringer/silent switch. AppDelegate puts the session in
 * `.playback` precisely so the panel's audio survives that switch (it is a wall
 * fixture, and the switch cannot be read or set from code); a system sound threw
 * that exemption away, so the countdown tick (Web Audio) survived silent mode
 * while the shutter did not. Playing the same .caf through an `AVAudioPlayer`
 * puts it on that `.playback` session, so it rides the same exemption as
 * everything else and the switch stops mattering.
 *
 * The path comes from JS rather than being hardcoded here, so changing the sound
 * (or the community-mapped UISounds location, which Apple does not contract)
 * never needs a native rebuild, and an unreadable path fails as a logged no-op
 * rather than throwing into a capture sequence.
 */
@objc(UISoundPlugin)
public class UISoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UISoundPlugin"
    public let jsName = "UISound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise)
    ]

    /// An AVAudioPlayer stops the instant it deallocs, so each one is retained
    /// for the length of its sound and dropped when playback finishes. An array
    /// (not a single slot) lets rapid shutters overlap instead of cutting each
    /// other off. Only touched on the main queue, so no extra locking.
    private var players: [AVAudioPlayer] = []

    @objc func play(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing sound path")
            return
        }
        // AVAudioPlayer setup and the players array both live on the main queue:
        // the delegate callback that prunes a finished player is delivered there,
        // so keeping the append on the same queue avoids racing it.
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Plugin released")
                return
            }
            do {
                let player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
                player.delegate = self
                player.prepareToPlay()
                self.players.append(player)
                player.play()
            } catch {
                // A cue is decoration; a failed one must never break the capture
                // it accompanies. Log and resolve rather than reject.
                os_log("ui sound: could not play %@: %@", path, error.localizedDescription)
            }
            call.resolve()
        }
    }
}

extension UISoundPlugin: AVAudioPlayerDelegate {
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
        players.removeAll { $0 === player }
    }
}
