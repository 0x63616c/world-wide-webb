import Foundation

public enum TeslaAction: String, Codable, Sendable, CaseIterable {
    case lock, unlock, climateOn, climateOff, chargeStart, chargeStop
}

public enum TeslaChargingState: String, Decodable, Sendable {
    case charging, stopped, complete, disconnected
    case noPower = "no_power"
    case starting
}

public enum TeslaDriveState: String, Decodable, Sendable {
    case parked, driving, reversing, neutral
    public var isInGear: Bool { self != .parked }
}

public struct TeslaSoftwareUpdate: Decodable, Sendable, Equatable {
    public let status: String
    public let installedVersion: String?
    public let latestVersion: String?
}

public struct TeslaSnapshot: Decodable, Sendable, Equatable {
    public var stale: Bool?
    public var lastUpdatedAt: String?
    public let batteryPercent: Double
    public let rangeMiles: Double
    public let chargingState: TeslaChargingState
    public let chargePowerKW: Double
    public let locked: Bool
    public let climateOn: Bool
    public let cabinFahrenheit: Double
    public let odometerMiles: Double
    public let softwareUpdate: TeslaSoftwareUpdate?
    public let driveState: TeslaDriveState?
    public let vehicleOnline: Bool?
    public let cableConnected: Bool?
    public let chargeLimitPercent: Double?
    public let chargeCompleteAt: String?

    var isValid: Bool {
        (0...100).contains(batteryPercent) && (0...10_000).contains(rangeMiles)
            && (0...1_000).contains(chargePowerKW) && (-100...250).contains(cabinFahrenheit)
            && (0...10_000_000).contains(odometerMiles)
            && chargeLimitPercent.map { (0...100).contains($0) } != false
    }
}

public enum TeslaState: Decodable, Sendable, Equatable {
    case ready(TeslaSnapshot)
    case unconfigured, unavailable

    private enum CodingKeys: String, CodingKey { case status, data, stale, lastUpdatedAt }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(String.self, forKey: .status) {
        case "ready":
            var snapshot = try values.decode(TeslaSnapshot.self, forKey: .data)
            snapshot.stale = try values.decodeIfPresent(Bool.self, forKey: .stale)
            snapshot.lastUpdatedAt = try values.decodeIfPresent(String.self, forKey: .lastUpdatedAt)
            guard snapshot.isValid else {
                throw DecodingError.dataCorruptedError(
                    forKey: .data, in: values, debugDescription: "Invalid Tesla state.")
            }
            self = .ready(snapshot)
        case "unconfigured", "unavailable":
            guard try values.decodeNil(forKey: .data) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .data, in: values, debugDescription: "Unexpected Tesla data.")
            }
            self = try values.decode(String.self, forKey: .status) == "unconfigured" ? .unconfigured : .unavailable
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .status, in: values, debugDescription: "Unknown Tesla status.")
        }
    }
}

public struct TeslaAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }
    public func state() async throws -> TeslaState {
        try await client.get("tesla", as: TeslaState.self)
    }
    /// PIN travels in a POST body only, never a query string or persistent setting.
    public func command(_ action: TeslaAction, pin: String) async throws {
        struct Input: Encodable, Sendable {
            let action: TeslaAction
            let pin: String
        }
        struct Acknowledgement: Decodable, Sendable { let accepted: Bool }
        guard pin.utf8.count == 6, pin.utf8.allSatisfy({ (48...57).contains($0) }) else {
            throw PanelAPIError.decoding("Enter the six-digit panel PIN.")
        }
        let result = try await client.post(
            "tesla/commands", input: Input(action: action, pin: pin),
            as: Acknowledgement.self)
        guard result.accepted else { throw PanelAPIError.decoding("Tesla command was not accepted.") }
    }
}
