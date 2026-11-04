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
        let settings = try await client.query("settings.get", as: PINSetting.self)
        return pin == settings.pinCode
    }
    public func change(current: String, replacement: String) async throws {
        guard Self.isValid(current), Self.isValid(replacement) else { throw Failure.invalidFormat }
        guard try await verify(current) else { throw Failure.incorrectCurrentPIN }
        try Task.checkCancellation()
        _ = try await client.mutation("settings.set", input: PINSetting(pinCode: replacement), as: PINSetting.self)
    }
    private struct PINSetting: Codable, Sendable { let pinCode: String }
}
