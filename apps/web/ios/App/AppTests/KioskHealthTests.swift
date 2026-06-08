// Pure-logic regression tests for the kiosk recovery watchdog (www-bwoy).
//
// These exercise KioskHealth — the UIKit-free core that decides whether the
// hosted dashboard is healthy and how long to wait before the next reload.
// Run via apps/web/ios/scripts/test-kiosk-health.sh, which compiles this
// alongside KioskHealth.swift with swiftc (no Xcode/simulator needed), so it
// works as a real red-before/green-after guard for the recovery behavior.
//
// Why a separate guard and not the vitest suite: the recovery logic is native
// Swift in the Capacitor shell and cannot be exercised by the web (jsdom) tests.

import Foundation

enum Check {
    static var failures: [String] = []

    static func expect(_ cond: Bool, _ msg: String) {
        if cond {
            print("  ok   - \(msg)")
        } else {
            print("  FAIL - \(msg)")
            failures.append(msg)
        }
    }
}

@main
enum KioskHealthTests {
    static func main() {
        print("KioskHealth tests")

        // --- HTTP status classification ---
        // The wall panel only treats origin-level failure (5xx, incl. all the
        // Cloudflare tunnel/origin codes) as "reload-worthy". A served 2xx/3xx
        // page is healthy; 4xx is the app responding, not the origin being down,
        // so it is NOT treated as unhealthy (reloading a 4xx would just loop).
        Check.expect(KioskHealth.isHealthy(httpStatus: 200), "HTTP 200 is healthy")
        Check.expect(KioskHealth.isHealthy(httpStatus: 304), "HTTP 304 is healthy")
        Check.expect(!KioskHealth.isHealthy(httpStatus: 530), "HTTP 530 (CF 1033 tunnel down) is unhealthy")
        Check.expect(!KioskHealth.isHealthy(httpStatus: 521), "HTTP 521 (CF web server is down) is unhealthy")
        Check.expect(!KioskHealth.isHealthy(httpStatus: 502), "HTTP 502 is unhealthy")
        Check.expect(KioskHealth.isHealthy(httpStatus: 404), "HTTP 404 is the app responding, not origin-down")
        Check.expect(!KioskHealth.isHealthy(httpStatus: 0), "HTTP 0 (no response) is unhealthy")

        // --- Cloudflare error-page body detection ---
        // CF serves its error page with a 5xx status, but WKWebView renders it as
        // a normal successful load, so we also sniff the loaded DOM for CF error
        // markers. This is what makes the stuck "Error 1033" page recoverable.
        let cf1033 = """
        <html><head><title>worldwidewebb.co | 1033: Argo Tunnel error</title></head>
        <body><div class="cf-error-details cf-error-1033">
        <h1><span class="cf-error-type">Error</span><span class="cf-error-code">1033</span></h1>
        </div></body></html>
        """
        Check.expect(KioskHealth.looksLikeCloudflareError(html: cf1033), "detects Error 1033 Argo tunnel page")

        let cf521 = "<html><body><h2>Error 521 Ray ID: abc</h2><p>Web server is down</p></body></html>"
        Check.expect(KioskHealth.looksLikeCloudflareError(html: cf521), "detects Error 521 web-server-down page")

        let realDashboard = """
        <html><head><title>Control Center</title></head>
        <body><div id="root"><div class="tile">Weather</div></div></body></html>
        """
        Check.expect(!KioskHealth.looksLikeCloudflareError(html: realDashboard), "real dashboard DOM is not a CF error")
        Check.expect(!KioskHealth.looksLikeCloudflareError(html: ""), "empty body is not flagged as CF error")

        // --- Bounded exponential backoff ---
        // Reloads must not hammer the origin. Backoff grows exponentially from a
        // base and is capped, so a long outage settles into a steady retry cadence.
        let backoff = Backoff(base: 2, max: 60)
        Check.expect(backoff.delay(forAttempt: 0) == 2, "attempt 0 waits base (2s)")
        Check.expect(backoff.delay(forAttempt: 1) == 4, "attempt 1 doubles to 4s")
        Check.expect(backoff.delay(forAttempt: 2) == 8, "attempt 2 doubles to 8s")
        Check.expect(backoff.delay(forAttempt: 10) == 60, "large attempt is capped at max (60s)")
        Check.expect(backoff.delay(forAttempt: -1) == 2, "negative attempt clamps to base")

        if Check.failures.isEmpty {
            print("\nALL PASS")
            exit(0)
        } else {
            print("\n\(Check.failures.count) FAILURE(S)")
            exit(1)
        }
    }
}
