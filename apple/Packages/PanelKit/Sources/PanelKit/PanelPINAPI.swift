import Foundation

/// Uses the existing synced soft-lock setting (ADR-0004). Digits stay in memory;
/// only a confirmed replacement is sent, in the settings mutation's POST body.
public struct PanelPINAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }
    public enum Failure: Error, Equatable { case invalidFormat, incorrectCurrentPIN }
    public static func isValid(_ pin: String) -> Bool {
        pin.utf8.count == 6 && pin.utf8.allSatisfy { (48...57).contains($0) }
    }
    public func verify(_ pin: String) async throws -> Bool {
        guard Self.isValid(pin) else { return false }
        struct Reply: Decodable, Sendable { let verified: Bool }
        return try await client.post("settings/pin/verify", input: ["pin": pin], as: Reply.self).verified
    }
    public func change(current: String, replacement: String) async throws {
        guard Self.isValid(current), Self.isValid(replacement) else { throw Failure.invalidFormat }
        struct Reply: Decodable, Sendable { let changed: Bool }
        do {
            _ = try await client.patch("settings/pin", input: ["current": current, "replacement": replacement], as: Reply.self)
        } catch PanelAPIError.server(_, _, let status) where status == 403 {
            throw Failure.incorrectCurrentPIN
        }
    }
}
