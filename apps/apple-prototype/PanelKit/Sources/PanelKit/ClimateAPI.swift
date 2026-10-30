import Foundation

public enum ClimateAPIMode: String, Codable, Sendable, CaseIterable {
    case off, cool, heat, heatCool = "heat_cool"
}

public enum ClimateAction: String, Decodable, Sendable {
    case cooling = "Cooling", heating = "Heating", idle = "Idle"
}

/// Discriminated exactly like features/ac/api.ts. Off retains nullable setpoints.
public struct ClimateAPIState: Decodable, Sendable {
    public enum Setpoints: Sendable, Equatable {
        case off(target: Double?, low: Double?, high: Double?)
        case single(Int)
        case range(low: Int, high: Int)
    }
    public let mode: ClimateAPIMode
    public let ambient: Double
    public let action: ClimateAction
    public let setpoints: Setpoints

    private enum CodingKeys: String, CodingKey { case mode, ambient, action, target, targetLow, targetHigh }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        mode = try values.decode(ClimateAPIMode.self, forKey: .mode)
        ambient = try values.decode(Double.self, forKey: .ambient)
        action = try values.decode(ClimateAction.self, forKey: .action)
        switch mode {
        case .off:
            // These keys are required by the output schema, even when null.
            setpoints = .off(target: try values.decode(Double?.self, forKey: .target),
                             low: try values.decode(Double?.self, forKey: .targetLow),
                             high: try values.decode(Double?.self, forKey: .targetHigh))
        case .cool, .heat: setpoints = .single(try values.decode(Int.self, forKey: .target))
        case .heatCool:
            setpoints = .range(low: try values.decode(Int.self, forKey: .targetLow),
                               high: try values.decode(Int.self, forKey: .targetHigh))
        }
    }
}

public struct ClimateAPI: Sendable {
    public static let temperatureRange = 67...77
    public static let minimumGap = 2
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func get() async throws -> ClimateAPIState {
        try await client.query("climate.get", as: ClimateAPIState.self)
    }
    public func setMode(_ mode: ClimateAPIMode) async throws -> ClimateAPIState {
        try await client.mutation("climate.setMode", input: mode, as: ClimateAPIState.self)
    }
    public func setTarget(_ target: Int) async throws -> ClimateAPIState {
        try await client.mutation("climate.setTarget", input: target, as: ClimateAPIState.self)
    }
    /// Validation remains authoritative on the server, including band and gap errors.
    public func setRange(low: Int, high: Int) async throws -> ClimateAPIState {
        struct Input: Encodable, Sendable { let low: Int; let high: Int }
        return try await client.mutation("climate.setRange", input: Input(low: low, high: high), as: ClimateAPIState.self)
    }
}
