import Foundation

/// Fan-only projection of controls.list / controls.toggle. Other control groups are ignored.
public struct FanSnapshot: Decodable, Sendable, Equatable {
    public let fan: ControlFanState
}

public struct FanAPI: Sendable {
    private let client: PanelAPIClient

    public init(client: PanelAPIClient) { self.client = client }

    public func setMode(_ mode: String) async throws -> FanSnapshot {
        struct Input: Encodable, Sendable { let mode: String }
        return try await client.mutation("controls.setFanMode", input: Input(mode: mode), as: FanSnapshot.self)
    }

    public func list() async throws -> FanSnapshot {
        try await client.query("controls.list", as: FanSnapshot.self)
    }

    /// false selects the A/C's automatic fan mode, rather than turning the A/C off.
    public func toggle(on: Bool) async throws -> FanSnapshot {
        struct Input: Encodable, Sendable { let key = "fan"; let on: Bool }
        return try await client.mutation("controls.toggle", input: Input(on: on), as: FanSnapshot.self)
    }
}
