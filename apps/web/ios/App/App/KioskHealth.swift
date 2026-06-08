import Foundation

// Pure, UIKit-free core of the kiosk recovery watchdog (CC-bwoy).
//
// The wall panel is an unattended Capacitor shell pointed at the hosted
// dashboard. When Cloudflare can't reach the origin it serves an error page
// (e.g. "Error 1033: Argo Tunnel error", HTTP 530) which WKWebView renders as
// a normal successful load — so the panel sticks on the error page forever and
// only a manual force-quit recovers it. This type holds the decisions the
// watchdog makes; keeping it free of UIKit/WebKit lets it be unit-tested with
// plain swiftc (see scripts/test-kiosk-health.sh).
enum KioskHealth {
    // Origin-down classification. Only 5xx (which covers every Cloudflare
    // tunnel/origin code — 520-527, 530) and "no response" (status 0) mean the
    // origin is unreachable and a reload is worth attempting. A 4xx is the app
    // itself answering, not the origin being down, so reloading it would just
    // loop; treat it as healthy for recovery purposes.
    static func isHealthy(httpStatus: Int) -> Bool {
        httpStatus >= 200 && httpStatus < 500
    }

    // Cloudflare serves its error page with a 5xx status, but WKWebView renders
    // it as a normal load and fires no navigation failure — so we also sniff the
    // loaded document for CF's stable error markers. These strings appear on CF's
    // error templates and not on the real dashboard.
    private static let cloudflareMarkers = [
        "cf-error-details",
        "cf-error-code",
        "cf-wrapper",
        "argo tunnel error",
        "web server is down",
        "error 1033",
        "error 520",
        "error 521",
        "error 522",
        "error 523",
        "error 524",
        "error 525",
        "error 526",
        "error 530",
    ]

    static func looksLikeCloudflareError(html: String) -> Bool {
        if html.isEmpty { return false }
        let haystack = html.lowercased()
        return cloudflareMarkers.contains { haystack.contains($0) }
    }
}

// Bounded exponential backoff so a long outage settles into a steady retry
// cadence instead of hammering the origin the moment it might be recovering.
struct Backoff {
    let base: TimeInterval
    let max: TimeInterval

    func delay(forAttempt attempt: Int) -> TimeInterval {
        guard attempt > 0 else { return base }
        // Cap the exponent so `pow` can't overflow on a very long outage.
        let exponent = Swift.min(attempt, 32)
        let scaled = base * pow(2.0, Double(exponent))
        return Swift.min(max, scaled)
    }
}
