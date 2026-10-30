import Foundation

public struct PanelConfiguration: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let baseURL: URL
    public let accessClientID: String?
    public let accessClientSecret: String?
    public let requestTimeout: TimeInterval

    public init(baseURL: URL, accessClientID: String? = nil, accessClientSecret: String? = nil,
                requestTimeout: TimeInterval = 30) {
        self.baseURL = baseURL
        self.accessClientID = accessClientID
        self.accessClientSecret = accessClientSecret
        self.requestTimeout = requestTimeout
    }

    public static func fromEnvironment(
        _ env: [String: String] = ProcessInfo.processInfo.environment
    ) -> PanelConfiguration? {
        guard let raw = env["WWW_PANEL_API_URL"], !raw.isEmpty,
              raw == raw.trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: raw), isValidBaseURL(url) else { return nil }
        return PanelConfiguration(
            baseURL: url,
            accessClientID: nonempty(env["WWW_CF_ACCESS_CLIENT_ID"]),
            accessClientSecret: nonempty(env["WWW_CF_ACCESS_CLIENT_SECRET"])
        )
    }

    /// The URL comes from the environment. Keychain fills missing credential fields only.
    public static func resolve(
        _ env: [String: String] = ProcessInfo.processInfo.environment
    ) -> PanelConfiguration? {
        guard let configuration = fromEnvironment(env) else { return nil }
        #if canImport(Security)
        return configuration.fillingCredentials { try? PanelKeychain.load($0) }
        #else
        return configuration
        #endif
    }

    #if canImport(Security)
    // Injectable lookup keeps resolution tests independent of the user's real Keychain.
    func fillingCredentials(_ load: (PanelKeychain.Key) -> String?) -> PanelConfiguration {
        PanelConfiguration(
            baseURL: baseURL,
            accessClientID: accessClientID ?? Self.nonempty(load(.accessClientID)),
            accessClientSecret: accessClientSecret ?? Self.nonempty(load(.accessClientSecret)),
            requestTimeout: requestTimeout
        )
    }
    #endif

    static func isValidBaseURL(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = parts.host, !host.isEmpty, !host.contains(where: { $0.isWhitespace }),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil
        else { return false }
        let scheme = parts.scheme?.lowercased()
        let loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host.lowercased())
        return scheme == "https" || (scheme == "http" && loopback)
    }

    private static func nonempty(_ value: String?) -> String? {
        value.flatMap { $0.isEmpty ? nil : $0 }
    }

    // Omit the URL as well: a configuration description should never expose deployment details.
    public var description: String {
        "PanelConfiguration(baseURL: <redacted>, accessClientID: \(accessClientID == nil ? "nil" : "<redacted>"), accessClientSecret: \(accessClientSecret == nil ? "nil" : "<redacted>"), requestTimeout: \(requestTimeout))"
    }
    public var debugDescription: String { description }
}
