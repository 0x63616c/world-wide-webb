import Foundation

/// Wall switch behaviour stored on the panel server. Field names match `/api/v1/switches`.
public struct WallSwitchSettings: Codable, Sendable, Equatable {
    public enum Mode: String, Codable, Sendable, CaseIterable { case off, room, gestures, smart }
    public enum DoubleAction: String, Codable, Sendable, CaseIterable {
        case none, apartmentToggle, allOff, allOn
    }
    public enum TripleAction: String, Codable, Sendable, CaseIterable { case none, party, white, red, blue, mood }

    public var bedroomMode: Mode
    public var frontDoorMode: Mode
    public var gestureWindowMs: Int
    public var bounceMs: Int
    public var doubleAction: DoubleAction
    public var includeRelays: Bool
    public var tripleAction: TripleAction
    public var confirmBlink: Bool
    public var smartAlarm: Bool
    public var smartParty: Bool
    public var smartNight: Bool
    public var nightStart: String
    public var nightEnd: String
    public var nightBrightness: Int
    public var nightKelvin: Int
}

public struct WallSwitch: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let entity: String?
    public let connected: Bool
}

public struct WallSwitchFlip: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let `switch`: String
    public let state: String
    public let at: String
    public let gapMs: Int?
    public let gesture: String
    public let action: String
}

public struct WallSwitchesSnapshot: Decodable, Sendable, Equatable {
    public var settings: WallSwitchSettings
    public let switches: [WallSwitch]
    public let flips: [WallSwitchFlip]
}

public struct WallSwitchesAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func load() async throws -> WallSwitchesSnapshot {
        try await client.get("switches", as: WallSwitchesSnapshot.self)
    }

    public func save(_ settings: WallSwitchSettings) async throws -> WallSwitchesSnapshot {
        try await client.patch("switches", input: settings, as: WallSwitchesSnapshot.self)
    }
}
