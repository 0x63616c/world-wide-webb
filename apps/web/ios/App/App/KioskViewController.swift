import Capacitor
import UIKit

class KioskViewController: CAPBridgeViewController {
    private var watchdog: KioskWatchdog?

    override var prefersStatusBarHidden: Bool {
        return true
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return UIDevice.current.userInterfaceIdiom == .pad ? .landscape : .portrait
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startWatchdogIfNeeded()
    }

    // The kiosk is unattended, so it must recover on its own from a Cloudflare
    // outage that leaves the WKWebView stuck on an error page (CC-bwoy). Start
    // the watchdog once the bridge has created the web view and resolved the
    // server URL it loaded; fall back to the live page URL if config is absent.
    private func startWatchdogIfNeeded() {
        guard watchdog == nil, let webView = webView else { return }
        // appStartServerURL is the remote `server.url` the kiosk loaded; fall
        // back to the live page URL if the bridge config isn't available yet.
        guard let origin = bridge?.config.appStartServerURL ?? webView.url else { return }
        let watchdog = KioskWatchdog(webView: webView, originURL: origin)
        watchdog.start()
        self.watchdog = watchdog
    }
}
