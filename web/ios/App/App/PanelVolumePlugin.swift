import AVFoundation
import Capacitor
import Foundation
import MediaPlayer
import os.log

/**
 * PanelVolume , reads and writes the device's media volume, and reports when
 * something else changes it.
 *
 * The panel is a wall fixture: nobody is going to walk over and hold the
 * hardware buttons to turn it down, so volume has to be settable from the
 * Settings page like brightness already is.
 *
 * READING is easy and fully supported , AVAudioSession.outputVolume is public
 * API and KVO-compliant, which is also the only way to learn that someone
 * pressed the hardware buttons (there is no notification for it).
 *
 * WRITING is not. Apple deliberately provides no API to set system volume: it
 * is a user preference, and the developer forums say so explicitly. The only
 * mechanism that works is reaching into MPVolumeView for the UISlider it
 * contains and setting its value. That is undocumented, and a future iOS could
 * rearrange those subviews and turn this into a silent no-op.
 *
 * That risk is accepted here because this app is internal and TestFlight-only ,
 * it is never submitted for App Store review, which is the usual reason to
 * avoid the technique. It is contained in two ways: the slider is looked up
 * defensively (a miss is logged, not a crash), and every write is verified
 * against outputVolume afterwards so a future breakage shows up in the logs as
 * a mismatch rather than as a slider that mysteriously does nothing.
 *
 * The offscreen MPVolumeView has a second, welcome effect: iOS suppresses its
 * own volume HUD while a volume view is on screen, so changing volume from
 * Settings does not flash a system overlay across the wall panel.
 */
@objc(PanelVolumePlugin)
public class PanelVolumePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PanelVolumePlugin"
    public let jsName = "PanelVolume"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
    ]

    /// How far the read-back may drift from the requested value before it counts
    /// as a failed write. iOS quantises volume into 16 steps (0.0625 apart), so
    /// an exact comparison would report a false failure on almost every write.
    private static let volumeEpsilon: Float = 0.05

    /// Held offscreen rather than hidden: `isHidden = true` or `alpha = 0` stops
    /// the slider from responding, and the whole technique depends on it being a
    /// live view in the hierarchy.
    private var volumeView: MPVolumeView?
    private var observation: NSKeyValueObservation?

    override public func load() {
        DispatchQueue.main.async { [weak self] in
            self?.attachVolumeView()
        }
        startObservingVolume()
    }

    deinit {
        observation?.invalidate()
    }

    // MARK: - setup

    private func attachVolumeView() {
        guard volumeView == nil else { return }
        let view = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 1, height: 1))
        view.isUserInteractionEnabled = false
        // The webview's window is the only hierarchy this plugin can rely on
        // being present; without a superview the slider is inert.
        guard let host = bridge?.viewController?.view else {
            os_log("panel volume: no host view, set-volume will be unavailable")
            return
        }
        host.addSubview(view)
        volumeView = view
    }

    /// KVO on outputVolume is what surfaces a hardware button press. Nothing
    /// else reports it, so without this the panel's stored volume would silently
    /// diverge from the device the moment anyone touched the buttons.
    private func startObservingVolume() {
        let session = AVAudioSession.sharedInstance()
        observation = session.observe(\.outputVolume, options: [.new]) { [weak self] _, change in
            guard let value = change.newValue else { return }
            self?.notifyListeners("volumeChanged", data: ["value": Double(value)])
        }
    }

    // MARK: - methods

    @objc func getVolume(_ call: CAPPluginCall) {
        call.resolve(["value": Double(AVAudioSession.sharedInstance().outputVolume)])
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        guard let requested = call.getDouble("value") else {
            call.reject("Missing volume value")
            return
        }
        let target = Float(min(1, max(0, requested)))

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Plugin released")
                return
            }
            self.attachVolumeView()
            guard let slider = self.volumeView?.subviews.compactMap({ $0 as? UISlider }).first else {
                // The undocumented part failing. Reject rather than resolve so
                // the web layer can log it against the value it tried to set.
                os_log("panel volume: MPVolumeView has no slider, cannot set volume")
                call.reject("Volume slider unavailable")
                return
            }
            slider.value = target

            // Read back on the next runloop turn , the write is applied
            // asynchronously, so an immediate read still returns the old value.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                let actual = AVAudioSession.sharedInstance().outputVolume
                if abs(actual - target) > Self.volumeEpsilon {
                    os_log(
                        "panel volume: set to %f but device reports %f",
                        Double(target), Double(actual)
                    )
                }
                call.resolve(["value": Double(actual)])
            }
        }
    }
}
