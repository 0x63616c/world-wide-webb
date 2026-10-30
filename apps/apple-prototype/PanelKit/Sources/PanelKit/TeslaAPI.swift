import Foundation

public enum TeslaAction: String, Codable, Sendable, CaseIterable {
    case lock, unlock, climateOn, climateOff, chargeStart, chargeStop
}

public enum TeslaChargingState: String, Decodable, Sendable {
    case charging, stopped, complete, disconnected, noPower = "no_power", starting
}

public struct TeslaSnapshot: Decodable, Sendable, Equatable {
    public let batteryPercent: Double
    public let rangeMiles: Double
    public let chargingState: TeslaChargingState
    public let chargePowerKW: Double
    public let locked: Bool
    public let climateOn: Bool
    public let cabinFahrenheit: Double
    public let odometerMiles: Double

    var isValid: Bool {
        (0...100).contains(batteryPercent) && (0...10_000).contains(rangeMiles)
            && (0...1_000).contains(chargePowerKW) && (-100...250).contains(cabinFahrenheit)
            && (0...10_000_000).contains(odometerMiles)
    }
}

public enum TeslaState: Decodable, Sendable, Equatable {
    case ready(TeslaSnapshot), unconfigured, unavailable

    private enum CodingKeys: String, CodingKey { case status, data }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(String.self, forKey: .status) {
        case "ready":
            let snapshot = try values.decode(TeslaSnapshot.self, forKey: .data)
            guard snapshot.isValid else {
                throw DecodingError.dataCorruptedError(forKey: .data, in: values, debugDescription: "Invalid Tesla state.")
            }
            self = .ready(snapshot)
        case "unconfigured", "unavailable":
            guard try values.decodeNil(forKey: .data) else {
                throw DecodingError.dataCorruptedError(forKey: .data, in: values, debugDescription: "Unexpected Tesla data.")
            }
            self = try values.decode(String.self, forKey: .status) == "unconfigured" ? .unconfigured : .unavailable
        default:
            throw DecodingError.dataCorruptedError(forKey: .status, in: values, debugDescription: "Unknown Tesla status.")
        }
    }
}

public struct TeslaAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }
    public func state() async throws -> TeslaState {
        try await client.query("tesla.state", as: TeslaState.self)
    }
    /// PIN travels in a POST body only, never a query string or persistent setting.
    public func command(_ action: TeslaAction, pin: String) async throws {
        struct Input: Encodable, Sendable { let action: TeslaAction; let pin: String }
        struct Acknowledgement: Decodable, Sendable { let accepted: Bool }
        guard pin.utf8.count == 6, pin.utf8.allSatisfy({ (48...57).contains($0) }) else {
            throw PanelAPIError.decoding("Enter the six-digit panel PIN.")
        }
        let result = try await client.mutation("tesla.command", input: Input(action: action, pin: pin),
                                               as: Acknowledgement.self)
        guard result.accepted else { throw PanelAPIError.decoding("Tesla command was not accepted.") }
    }
}
