import Foundation

/// Privately provisioned per-device Cloudflare credentials plus the backend
/// token. This record is never bundled, logged, synced or stored in defaults.
public struct PanelEnrollment: Codable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let baseURL: URL
    public let apiToken: String
    public let accessClientID: String?
    public let accessClientSecret: String?
    public var description: String { "PanelEnrollment(<redacted>)" }
    public var debugDescription: String { description }
    public static let changed = Notification.Name("PanelConnectionChanged")
    public static func parse(_ text: String) throws -> PanelEnrollment {
        guard text.utf8.count <= 16_384, let bytes = text.data(using: .utf8),
              let value = try? JSONDecoder().decode(Self.self, from: bytes), value.isValid else {
            throw PanelAPIError.decoding("Invalid connection details.")
        }
        return value
    }
    private var isValid: Bool {
        let valid: (String) -> Bool = { !$0.isEmpty && $0.utf8.count <= 4096 && !$0.contains(where: { $0.isWhitespace }) }
        let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(baseURL.host ?? "")
        let pair = accessClientID.map(valid) == true && accessClientSecret.map(valid) == true
        return PanelConfiguration.isValidBaseURL(baseURL) && apiToken.utf8.count >= 32 && valid(apiToken)
            && (pair || (loopback && accessClientID == nil && accessClientSecret == nil))
    }
    public var configuration: PanelConfiguration {
        PanelConfiguration(baseURL: baseURL, accessClientID: accessClientID,
            accessClientSecret: accessClientSecret, apiToken: apiToken)
    }
    public func verify(transport: any PanelTransport = PanelAPIClient.defaultTransport) async throws {
        guard isValid else { throw PanelAPIError.notConfigured }
        struct Probe: Decodable, Sendable { let serverNow: String }
        _ = try await PanelAPIClient(configuration: configuration, transport: transport).get("alarms", as: Probe.self)
    }
    #if canImport(Security)
    public static func load() -> Self? {
        guard let raw = try? PanelKeychain.load(.enrollment) else { return nil }
        return try? parse(raw)
    }
    public func save() throws {
        guard isValid else { throw PanelAPIError.notConfigured }
        let bytes = try JSONEncoder().encode(self)
        // One Keychain item makes credential replacement atomic.
        try PanelKeychain.save(String(decoding: bytes, as: UTF8.self), for: .enrollment)
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }
    public static func disconnect() throws {
        try PanelKeychain.save(nil, for: .enrollment)
        for key in [PanelKeychain.Key.apiToken, .accessClientID, .accessClientSecret] {
            try PanelKeychain.save(nil, for: key)
        }
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }
    #endif
}
