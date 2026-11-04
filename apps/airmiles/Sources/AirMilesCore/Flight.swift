import Foundation

public struct Airport: Codable, Hashable, Sendable, Identifiable {
    public var id: String { code }
    public let code: String
    public let name: String
    public let city: String
    public let country: String
    public let countryName: String
    public let latitude: Double
    public let longitude: Double
}

public enum Confidence: String, Codable, Sendable {
    case high = "H", medium = "M", low = "L"
    public var label: String {
        switch self { case .high: "High confidence"; case .medium: "Some details uncertain"; case .low: "Needs review" }
    }
}

public struct Flight: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let date: String
    public let airline: String
    public let number: String
    public let origin: String
    public let destination: String
    public let miles: Int
    public let confidence: Confidence
    public var year: String { String(date.prefix(4)) }
    public var flightNumber: String { number == "?" || number.isEmpty ? "Not recorded" : number }
    public var dateValue: Date { Self.dateFormatter.date(from: date) ?? .distantPast }
    /// Flight dates are calendar dates, not instants in the device's time zone.
    public var displayDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: dateValue)
    }
    public var route: String { "\(origin)–\(destination)" }

    static var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter
    }

    public func matches(_ query: String, airports: [String: Airport]) -> Bool {
        let fields = [date, airline, number, origin, destination,
                      airports[origin]?.city ?? "", airports[destination]?.city ?? "",
                      airports[origin]?.countryName ?? "", airports[destination]?.countryName ?? ""]
        let text = fields.joined(separator: " ")
        return query.split(whereSeparator: \.isWhitespace).allSatisfy {
            text.localizedStandardContains(String($0))
        }
    }
}

public struct FlightStats: Sendable {
    public let flights: [Flight]
    public let airports: [String: Airport]
    public init(flights: [Flight], airports: [String: Airport]) {
        self.flights = flights
        self.airports = airports
    }
    public var miles: Int { flights.reduce(0) { $0 + $1.miles } }
    public var airportCodes: Set<String> { Set(flights.flatMap { [$0.origin, $0.destination] }) }
    public var countryCodes: Set<String> { Set(airportCodes.compactMap { airports[$0]?.country }) }
    public var years: [String] { Set(flights.map(\.year)).sorted(by: >) }
    public var routes: Int { Set(flights.map { [$0.origin, $0.destination].sorted().joined(separator: "-") }).count }
    public var longest: Flight? { flights.max { $0.miles < $1.miles } }
    public var needsReview: Int { flights.filter { $0.confidence != .high }.count }
    public var earthLaps: Double { Double(miles) / 24_901 }
    public var topAirports: [(code: String, count: Int)] {
        Dictionary(grouping: flights.flatMap { [$0.origin, $0.destination] }, by: { $0 })
            .map { (code: $0.key, count: $0.value.count) }
            .sorted { $0.count == $1.count ? $0.code < $1.code : $0.count > $1.count }
    }
}
