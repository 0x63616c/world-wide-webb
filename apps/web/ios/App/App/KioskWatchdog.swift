import Foundation
import Network
import UIKit
import WebKit

// Recovery watchdog for the unattended wall-panel kiosk (www-bwoy).
//
// The shell renders the hosted dashboard in a WKWebView. When Cloudflare can't
// reach the origin it serves an error page (e.g. "Error 1033: Argo Tunnel
// error", HTTP 530) which WKWebView treats as a normal successful load and
// fires NO navigation-failure callback. So the panel sticks on the error page
// indefinitely; recovery previously required a manual force-quit on the iPad.
//
// This watchdog is deliberately DECOUPLED from how the load broke — it does not
// intercept Capacitor's navigation delegate. Instead it independently observes:
//   • a cheap periodic DOM sniff of the live page (CF error markers / missing
//     React root) — catches the stuck error page WKWebView reports as "loaded",
//   • network reachability (reload-probe when connectivity returns),
//   • app foreground (re-check whenever the panel is looked at again).
// When the page looks broken it probes the origin over HTTP; only once the
// origin answers healthy does it force-reload (cache-bypassing) the dashboard.
// Probes are throttled by bounded exponential backoff so a long outage never
// hammers the origin. All decision logic lives in the unit-tested KioskHealth.
final class KioskWatchdog {
    private weak var webView: WKWebView?
    private let originURL: URL
    // CF Access service-token credentials (www-cuuw). When the dashboard is gated,
    // the watchdog's own probe AND reload MUST carry these headers, or a session
    // expiry sends the probe to a 302->login (which isHealthy() calls "healthy")
    // and the header-less reload just re-renders the login wall forever. nil for
    // an open (ungated) origin — then no headers are injected (today's behavior).
    private let access: KioskAccess?

    // Reload settles into at most one probe / 120s during a sustained outage.
    private let backoff = Backoff(base: 3, max: 120)
    private let heartbeat: TimeInterval = 10
    // Require a couple of consecutive "no React root" samples before reloading,
    // so an in-flight first paint is never mistaken for a broken page.
    private let blankSamplesBeforeReload = 2

    private let pathMonitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "co.worldwidewebb.kiosk.watchdog")
    private let probeSession: URLSession
    private var timer: Timer?

    // Mutated only on the main thread.
    private var consecutiveOriginFailures = 0
    private var consecutiveBlankSamples = 0
    private var nextProbeAllowedAt = Date.distantPast
    private var hasNetwork = true

    init(webView: WKWebView, originURL: URL, access: KioskAccess? = nil) {
        self.webView = webView
        self.originURL = originURL
        self.access = access
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 10
        cfg.timeoutIntervalForResource = 12
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.waitsForConnectivity = false
        probeSession = URLSession(configuration: cfg)
    }

    func start() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(onForeground),
            name: UIApplication.didBecomeActiveNotification, object: nil
        )

        pathMonitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            DispatchQueue.main.async {
                guard let self else { return }
                let regained = satisfied && !self.hasNetwork
                self.hasNetwork = satisfied
                if regained {
                    // Connectivity just came back — probe immediately.
                    self.nextProbeAllowedAt = .distantPast
                    self.evaluate()
                }
            }
        }
        pathMonitor.start(queue: monitorQueue)

        let timer = Timer(timeInterval: heartbeat, repeats: true) { [weak self] _ in
            self?.evaluate()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    @objc private func onForeground() {
        nextProbeAllowedAt = .distantPast
        evaluate()
    }

    // Main thread. Sniffs the live page; only reaches out to the network when
    // the page looks broken AND backoff allows another probe.
    private func evaluate() {
        guard hasNetwork, let webView else { return }
        if webView.isLoading { return }

        // Slice keeps the bridge payload small; CF markers and the <title> sit
        // at the very top of CF's error template, and `hasRoot` is the positive
        // signal that the real dashboard mounted.
        let js = """
        (function () {
          var el = document.documentElement;
          var html = el ? el.outerHTML : "";
          var root = document.getElementById("root");
          return JSON.stringify({
            html: html.slice(0, 4000),
            hasRoot: !!(root && root.children.length > 0)
          });
        })()
        """

        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self else { return }
            var cfError = false
            var accessLogin = false
            var hasRoot = false
            if let json = result as? String,
               let data = json.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let html = obj["html"] as? String ?? ""
                cfError = KioskHealth.looksLikeCloudflareError(html: html)
                // CF Access login interstitial (session expired) — a third state
                // distinct from healthy + CF-error. Recognizing it lets us reload
                // WITH the Access headers instead of looping on the login wall.
                accessLogin = KioskHealth.looksLikeAccessLogin(html: html)
                hasRoot = (obj["hasRoot"] as? Bool) ?? false
            } else {
                // JS didn't even evaluate (blank/failed document) — treat as blank.
                cfError = false
                accessLogin = false
                hasRoot = false
            }

            self.consecutiveBlankSamples = hasRoot ? 0 : self.consecutiveBlankSamples + 1
            // The Access login page also counts as broken: it has no #root, but we
            // want to react immediately (re-navigate with headers) rather than
            // waiting out the blank-sample threshold.
            let broken = cfError || accessLogin
                || self.consecutiveBlankSamples >= self.blankSamplesBeforeReload
            guard broken else {
                self.consecutiveOriginFailures = 0
                return
            }
            guard Date() >= self.nextProbeAllowedAt else { return }
            self.probeOriginThenReload()
        }
    }

    // Build a cache-bypassing request to the origin, carrying the CF-Access
    // headers when the dashboard is gated (www-cuuw). Used by BOTH the probe and
    // the reload so neither bounces to the 302 Access-login page. When `access`
    // is nil (open origin) this is exactly today's header-less request.
    private func authedRequest() -> URLRequest {
        var request = URLRequest(url: originURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        if let access {
            for (name, value) in access.headers {
                request.setValue(value, forHTTPHeaderField: name)
            }
        }
        return request
    }

    private func probeOriginThenReload() {
        var request = authedRequest()
        request.httpMethod = "GET"
        probeSession.dataTask(with: request) { [weak self] _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            DispatchQueue.main.async {
                guard let self else { return }
                if error == nil, KioskHealth.isHealthy(httpStatus: status) {
                    self.consecutiveOriginFailures = 0
                    self.consecutiveBlankSamples = 0
                    // Brief grace so the reload can settle before re-evaluating.
                    self.nextProbeAllowedAt = Date().addingTimeInterval(self.backoff.base)
                    self.reloadDashboard()
                } else {
                    self.consecutiveOriginFailures += 1
                    let delay = self.backoff.delay(forAttempt: self.consecutiveOriginFailures)
                    self.nextProbeAllowedAt = Date().addingTimeInterval(delay)
                }
            }
        }.resume()
    }

    private func reloadDashboard() {
        guard let webView else { return }
        // Load the configured origin (not webView.reload()) so we always return
        // to the dashboard even if the stuck page navigated elsewhere, bypass the
        // cache so a cached CF error page is never re-shown, AND carry the
        // CF-Access headers (www-cuuw) so a session-expiry reload re-authenticates
        // through the gate rather than re-rendering the Access login wall.
        webView.load(authedRequest())
    }

    deinit {
        pathMonitor.cancel()
        timer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }
}
