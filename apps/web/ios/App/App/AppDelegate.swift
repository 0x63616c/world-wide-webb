import AVFoundation
import Capacitor
import UIKit
import os.log

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        application.isIdleTimerDisabled = true
        requestCameraAccessUpFront()
        configureAudioSession()
        return true
    }

    // The panel makes sound (the photo booth's shutter and countdown, and
    // whatever comes later), and under the default audio session category all of
    // it is silenced by the iPad's physical mute switch. That switch cannot be
    // read or set from code - there is no API for it at all - so a panel muted
    // by a flick of a switch nobody remembers touching would be undiagnosable
    // from the app's side.
    //
    // `.playback` is the category for audio that IS the point rather than
    // accompanying something else, and iOS exempts it from the mute switch. For
    // a wall fixture that is the honest description: its sounds are deliberate,
    // and the volume slider in Settings is the way to silence it.
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Non-fatal: sound still plays, it just obeys the mute switch again.
            os_log("kiosk audio session setup failed: %@", error.localizedDescription)
        }
    }

    // Wake-photo bursts call getUserMedia from the webview mid-wake, and WebKit
    // denies instantly (NotAllowedError) unless the app-level camera permission
    // is already granted - on the kiosk panel the TCC prompt cannot be answered
    // mid-wake ("camera open failed" on every wake, per wake-capture.ts's
    // console.warn). Requesting up front makes the prompt appear once, deterministically, at
    // app launch where someone standing at the panel can accept it; after that
    // the grant persists across builds. If camera is already denied in Settings
    // this is a silent no-op (no prompt), so the os_log status line is the way
    // to tell "never asked" from "denied on the device".
    private func requestCameraAccessUpFront() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        os_log("kiosk camera authorization status: %d", status.rawValue)
        guard status == .notDetermined else { return }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            os_log("kiosk camera access prompt result: granted=%d", granted)
        }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
