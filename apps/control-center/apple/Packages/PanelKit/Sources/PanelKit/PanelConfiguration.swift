import Foundation

public struct PanelConfiguration: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public static let defaultBaseURL = URL(string: "https://homelab.tail8c014d.ts.net")!
    public let baseURL: URL
    public let requestTimeout: TimeInterval
    public init(baseURL: URL = Self.defaultBaseURL, requestTimeout: TimeInterval = 30) {
        self.baseURL = baseURL
        self.requestTimeout = requestTimeout
    }
    public static func fromEnvironment(_ env: [String: String] = ProcessInfo.processInfo.environment) -> Self? {
        guard let raw = env["WWW_PANEL_API_URL"], raw == raw.trimmingCharacters(in: .whitespacesAndNewlines),
            let url = URL(string: raw), isValidBaseURL(url)
        else { return nil }
        return Self(baseURL: url)
    }
    public static func resolve(_ env: [String: String] = ProcessInfo.processInfo.environment) -> Self? {
        fromEnvironment(env)
    }
    static func isValidBaseURL(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let host = parts.host, !host.isEmpty, !host.contains(where: { $0.isWhitespace }),
            parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil
        else { return false }
        let loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host.lowercased())
        return parts.scheme?.lowercased() == "https" || (parts.scheme?.lowercased() == "http" && loopback)
    }
    public var description: String { "PanelConfiguration(baseURL: <redacted>, requestTimeout: \(requestTimeout))" }
    public var debugDescription: String { description }
}
