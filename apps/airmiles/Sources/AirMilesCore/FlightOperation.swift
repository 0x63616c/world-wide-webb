import Foundation

/// A sourced sidecar: enrichment never changes the imported journal or its confidence.
public struct FlightEnrichment: Codable, Sendable {
    public let version: Int
    public let retrievedAt: String
    public let latestMonth: String
    public let records: [String: FlightOperation]

    public static func load(_ data: Data) throws -> Self {
        let document = try JSONDecoder().decode(Self.self, from: data)
        guard document.version == 1 else {
            throw FlightImportError.invalid("This enrichment file uses an unsupported version.")
        }
        return document
    }

    public func operation(for flight: Flight) -> FlightOperation? { records[flight.enrichmentKey] }
}

extension Flight {
    /// Stable across sorting and reimporting; original identity remains authoritative.
    public var enrichmentKey: String { [date, airline, number, origin, destination].joined(separator: "|") }
}

public struct FlightOperation: Codable, Sendable {
    public let source: String
    public let sourceURL: String
    public let operatingCarrier: String
    public let operatingFlightNumber: String
    public let tailNumber: String?
    /// Local airport clocks, as published by BTS. 24:00 means midnight at day's end.
    public let scheduledDeparture: String?
    public let actualDeparture: String?
    public let scheduledArrival: String?
    public let actualArrival: String?
    public let departureDelay: Int?
    public let arrivalDelay: Int?
    public let elapsedMinutes: Int?
    public let airborneMinutes: Int?
    public let cancelled: Bool
    public let diverted: Bool

    public var arrivalSummary: String? {
        if cancelled { return "Cancelled" }
        if diverted { return "Diverted" }
        guard let minutes = arrivalDelay else { return nil }
        if minutes == 0 { return "Arrived on time" }
        return "Arrived \(abs(minutes)) min \(minutes < 0 ? "early" : "late")"
    }

    public var safeArrival: String? { cancelled || diverted ? nil : actualArrival }
    public var duration: String? {
        guard !cancelled, !diverted, let minutes = elapsedMinutes, minutes > 0 else { return nil }
        return minutes < 60 ? "\(minutes) min" : "\(minutes / 60)h \(minutes % 60)m"
    }
}
