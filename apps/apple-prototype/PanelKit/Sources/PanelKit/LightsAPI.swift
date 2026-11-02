import Foundation

public enum ControlKey: String, Codable, Sendable, CaseIterable {
    case lamps, lights, fan, bedroomLamps, otherLamps, ceiling, cabinet, all
}

public enum LampScene: String, Codable, Sendable, CaseIterable { case white, mood, red, blue }
public enum ActiveLampScene: String, Codable, Sendable, CaseIterable { case white, mood, red, blue, party }
public enum LampColorSlot: String, Codable, Sendable, CaseIterable { case red, blue, custom }
public enum LampMode: String, Codable, Sendable { case none, party }
public enum LampModeSpeed: String, Codable, Sendable, CaseIterable { case slow, medium, fast }

public struct SavedLampColor: Decodable, Sendable, Equatable {
    public let slot: LampColorSlot
    public let label: String
    public let hex: String
}

public struct ControlsLampState: Decodable, Sendable, Equatable {
    public let on: Bool
    public let count: Int
    public let brightness: Int
    public let sub: String
    public let pending: Bool
    public let activeScene: ActiveLampScene?
    public let whiteKelvin: Int
    public let savedColors: [SavedLampColor]
}

public struct ControlGroupState: Decodable, Sendable, Equatable {
    public let on: Bool
    public let pending: Bool
}

public struct ControlFanState: Decodable, Sendable, Equatable {
    public let modes: [String]?
    public let mode: String?
    public let on: Bool
    public let sub: String
    public let pending: Bool
}

public struct ControlsState: Decodable, Sendable, Equatable {
    public let lamps: ControlsLampState
    public let lights: ControlGroupState
    public let fan: ControlFanState
    public let bedroomLamps: ControlGroupState
    public let otherLamps: ControlGroupState
    public let ceiling: ControlGroupState
    public let cabinet: ControlGroupState
    public let all: ControlGroupState

    public var pendingKeys: Set<String> {
        Set([(ControlKey.lamps, lamps.pending), (.lights, lights.pending), (.fan, fan.pending),
             (.bedroomLamps, bedroomLamps.pending), (.otherLamps, otherLamps.pending),
             (.ceiling, ceiling.pending), (.cabinet, cabinet.pending), (.all, all.pending)]
            .compactMap { $0.1 ? $0.0.rawValue : nil })
    }

    public func isOn(_ key: ControlKey) -> Bool {
        switch key {
        case .lamps: lamps.on
        case .lights: lights.on
        case .fan: fan.on
        case .bedroomLamps: bedroomLamps.on
        case .otherLamps: otherLamps.on
        case .ceiling: ceiling.on
        case .cabinet: cabinet.on
        case .all: all.on
        }
    }
}

public struct LightsAPI: Sendable {
    public static let whiteKelvinRange = 2000...6500
    public static let brightnessRange = 0...100
    private let client: PanelAPIClient

    public init(client: PanelAPIClient) { self.client = client }

    public func list() async throws -> ControlsState {
        try await client.query("controls.list", as: ControlsState.self)
    }

    public func toggle(_ key: ControlKey, on: Bool) async throws -> ControlsState {
        struct Input: Encodable, Sendable { let key: ControlKey; let on: Bool }
        return try await client.mutation("controls.toggle", input: Input(key: key, on: on), as: ControlsState.self)
    }

    public func setScene(_ scene: LampScene) async throws -> ControlsState {
        try await client.mutation("controls.setLampScene", input: ["scene": scene], as: ControlsState.self)
    }

    public func setColor(slot: LampColorSlot, hex: String? = nil) async throws -> ControlsState {
        if let hex, !Self.isValidColor(hex) { throw invalidInput("Color must be a six-digit hex value prefixed with #.") }
        struct Input: Encodable, Sendable { let slot: LampColorSlot; let hex: String? }
        return try await client.mutation("controls.setLampColor", input: Input(slot: slot, hex: hex), as: ControlsState.self)
    }

    public func setWhiteKelvin(_ kelvin: Int) async throws -> ControlsState {
        guard Self.whiteKelvinRange.contains(kelvin) else { throw invalidInput("White temperature must be 2000–6500 kelvin.") }
        return try await client.mutation("controls.setWhiteKelvin", input: ["kelvin": kelvin], as: ControlsState.self)
    }

    public func setBrightness(pct: Int) async throws -> ControlsState {
        guard Self.brightnessRange.contains(pct) else { throw invalidInput("Brightness must be 0–100 percent.") }
        return try await client.mutation("controls.setLampBrightness", input: ["pct": pct], as: ControlsState.self)
    }

    public func setMode(_ mode: LampMode, speed: LampModeSpeed? = nil) async throws -> ControlsState {
        struct Input: Encodable, Sendable { let mode: LampMode; let speed: LampModeSpeed? }
        return try await client.mutation("controls.setLampMode", input: Input(mode: mode, speed: speed), as: ControlsState.self)
    }

    public static func isValidColor(_ hex: String) -> Bool {
        hex.count == 7 && hex.first == "#" && hex.dropFirst().allSatisfy { $0.isASCII && $0.isHexDigit }
    }

    private func invalidInput(_ message: String) -> PanelAPIError {
        .server(code: "BAD_REQUEST", message: message, httpStatus: 400)
    }
}
