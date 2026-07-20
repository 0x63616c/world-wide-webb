import AudioToolbox
import Capacitor
import Foundation

/**
 * SystemSound , plays an iOS system sound by id.
 *
 * The photo booth's shutter used to be synthesized in the webview with the Web
 * Audio API (two band-passed noise bursts). It read as harsh, and the obvious
 * alternative , bundling a recording , means an audio asset in the repo plus a
 * licence to honour. iOS already ships the real camera shutter at
 * /System/Library/Audio/UISounds/photoShutter.caf, so the kiosk can just ask
 * the system to play it: no bytes bundled, no licence question, and it is the
 * sound everyone already reads as "photo taken".
 *
 * `AudioServicesPlaySystemSound` is public, documented AudioToolbox API. The
 * numeric IDs are NOT documented by Apple , 1108 (photoShutter) is
 * community-mapped and has been stable for years, but it is not contractual.
 * The id therefore comes from JS rather than being hardcoded here, so changing
 * it (or falling back) never needs a native rebuild, and an unknown id fails
 * silently as a no-op rather than throwing into a capture sequence.
 */
@objc(SystemSoundPlugin)
public class SystemSoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SystemSoundPlugin"
    public let jsName = "SystemSound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise)
    ]

    @objc func play(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Missing sound id")
            return
        }
        // System sound playback is asynchronous and cheap; there is nothing to
        // await, so resolve immediately rather than holding the JS promise for
        // the length of the sound.
        AudioServicesPlaySystemSound(SystemSoundID(UInt32(truncatingIfNeeded: id)))
        call.resolve()
    }
}
