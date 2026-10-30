import Foundation

struct WebOrigin: Equatable, Sendable {
    let scheme: String
    let host: String
    let port: Int

    init?(url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        self.scheme = scheme
        self.host = host
        self.port = url.port ?? (scheme == "https" ? 443 : 80)
    }

    init?(scheme: String, host: String, port: Int) {
        guard ["http", "https"].contains(scheme.lowercased()), !host.isEmpty else { return nil }
        self.scheme = scheme.lowercased()
        self.host = host.lowercased()
        self.port = port == 0 ? (self.scheme == "https" ? 443 : 80) : port
    }
}

enum KioskURLPolicy {
    static func httpURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), WebOrigin(url: url) != nil,
              url.user == nil, url.password == nil else { return nil }
        return url
    }

    static func isAllowed(_ raw: String, serverURL: URL) -> Bool {
        if raw == "about:blank" || raw.hasPrefix("blob:") { return true }
        guard let url = httpURL(raw), let host = url.host?.lowercased() else { return false }
        return host == "localhost" || host == serverURL.host?.lowercased() || host.hasSuffix(".worldwidewebb.co")
    }

    static func isTrusted(_ url: URL?, serverURL: URL) -> Bool {
        guard let url, let origin = WebOrigin(url: url), let expected = WebOrigin(url: serverURL) else { return false }
        return origin == expected
    }

    static func acceptsMessage(isMainFrame: Bool, origin: WebOrigin?, pageURL: URL?, serverURL: URL) -> Bool {
        isMainFrame && origin != nil && origin == WebOrigin(url: serverURL) && isTrusted(pageURL, serverURL: serverURL)
    }
}

enum KioskBoot {
    static func url(serverURL: URL, generation: Int, launchedAt: Int64) -> URL {
        var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        var items = (components.queryItems ?? []).filter { $0.name != "boot" }
        items.append(URLQueryItem(name: "boot", value: "\(generation)-\(launchedAt)"))
        components.queryItems = items
        return components.url!
    }

    static func timeout(attempt: Int) -> TimeInterval { 30 * Double(min(max(attempt, 0) + 1, 4)) }
    static func recoveryDelay(attempt: Int) -> TimeInterval { min(pow(2, Double(min(max(attempt, 0), 5))), 30) }
}
