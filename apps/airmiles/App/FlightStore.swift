import AirMilesCore
import Foundation
import Observation

@MainActor @Observable final class FlightStore {
    private(set) var flights: [Flight] = []
    private(set) var airports: [String: Airport] = [:]
    private(set) var isDemo = false
    private(set) var enrichment: FlightEnrichment?
    private var enrichmentFile: URL { URL.documentsDirectory.appending(path: "flight-enrichment.json") }
    var error: String?
    var selectedYear: String?
    var query = ""
    var reviewOnly = false
    private let demoMode: Bool
    private var savedFile: URL { URL.documentsDirectory.appending(path: "segments.csv") }

    init() {
        demoMode = ProcessInfo.processInfo.arguments.contains("--demo")
        do {
            guard let url = Bundle.main.url(forResource: "airports", withExtension: "json") else {
                throw FlightImportError.invalid("The airport catalog is missing.")
            }
            let catalog = try JSONDecoder().decode([Airport].self, from: Data(contentsOf: url))
            airports = Dictionary(uniqueKeysWithValues: catalog.map { ($0.code, $0) })
            if !demoMode && FileManager.default.fileExists(atPath: savedFile.path) {
                flights = try FlightCSV.parse(String(contentsOf: savedFile, encoding: .utf8))
            } else {
                flights = try FlightCSV.parse(Self.demoCSV)
                isDemo = true
            }
        } catch { self.error = error.localizedDescription }
        loadEnrichment()
    }

    private func loadEnrichment() {
        if isDemo {
            enrichment = try? FlightEnrichment.load(Data(Self.demoEnrichment.utf8))
        } else if FileManager.default.fileExists(atPath: enrichmentFile.path) {
            do { enrichment = try FlightEnrichment.load(Data(contentsOf: enrichmentFile)) }
            catch {
                enrichment = nil
                self.error = "Flights loaded, but the enrichment file could not be read."
            }
        } else { enrichment = nil }
    }

    var stats: FlightStats { FlightStats(flights: flights, airports: airports) }
    var filtered: [Flight] {
        flights.filter {
            (selectedYear == nil || $0.year == selectedYear) &&
            (!reviewOnly || $0.confidence != .high || enrichment?.reviewNote(for: $0) != nil) && $0.matches(query, airports: airports)
        }
    }
    func city(_ code: String) -> String { airports[code]?.city ?? code }
    func importCSV(from url: URL) throws {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        guard data.count < 5_000_000, let csv = String(data: data, encoding: .utf8) else {
            throw FlightImportError.invalid("Choose a UTF-8 CSV smaller than 5 MB.")
        }
        let parsed = try FlightCSV.parse(csv)
        // Validate before replacing anything, and strip private mailbox identifiers.
        let sanitized = Self.csv(for: parsed)
        try sanitized.write(to: savedFile, atomically: true, encoding: .utf8)
        flights = parsed; isDemo = false
        selectedYear = nil; query = ""; reviewOnly = false
        loadEnrichment()
    }
    private static func csv(for flights: [Flight]) -> String {
        func quote(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        return "date,airline,flight,from,to,miles,confidence\n" + flights.map {
            [$0.date, $0.airline, $0.number, $0.origin, $0.destination, String($0.miles), $0.confidence.rawValue].map(quote).joined(separator: ",")
        }.joined(separator: "\n")
    }

    // Synthetic operational details for visual tests, never represented as a BTS match.
    private static let demoEnrichment = #"""
    {"version":1,"retrievedAt":"2026-11-04","latestMonth":"2026-08","records":{
      "2026-08-21|United|UA16|HND|SFO":{
        "source":"Sample","sourceURL":"https://www.transtats.bts.gov/ONTIME/",
        "operatingCarrier":"UA","operatingFlightNumber":"16","tailNumber":"N000EX",
        "scheduledDeparture":"17:00","actualDeparture":"17:08",
        "scheduledArrival":"10:30","actualArrival":"10:22",
        "departureDelay":8,"arrivalDelay":-8,"elapsedMinutes":554,"airborneMinutes":527,
        "wheelsOff":"17:23","wheelsOn":"10:10","taxiOutMinutes":15,"taxiInMinutes":12,
        "cancelled":false,"diverted":false
      }
    },"bookings":{"2026-08-21|United|UA16|HND|SFO":{
      "source":"Sample","sent":"2026-08-01","scheduledDeparture":"17:00","scheduledArrival":"10:30",
      "bookedSeat":"24A","bookedCabin":"Economy","bookedAircraft":"Boeing 787-9","departureTerminal":"3"
    }},"observations":{"2026-08-21|United|UA16|HND|SFO":{
      "source":"Sample","sourceURL":"https://example.com","callsign":"EXAMPLE16","icao24":"000000",
      "tailNumber":"N000EX","aircraftType":"B789","firstSeenUTC":"2026-08-21T08:23:00Z","lastSeenUTC":"2026-08-21T17:10:00Z"
    }}}
    """#

    // Deliberately synthetic. Never substitute personal flight history in this fixture.
    static let demoCSV = """
    date,airline,flight,from,to,miles,confidence
    2026-10-18,Delta,DL204,JFK,LHR,3451,H
    2026-10-11,Delta,DL203,LHR,JFK,3451,H
    2026-08-21,United,UA16,HND,SFO,5130,H
    2026-08-10,United,UA15,SFO,HND,5130,H
    2026-04-06,Example Air,?,CDG,LHR,216,M
    2026-04-03,Example Air,EX90,LHR,CDG,216,H
    2025-12-12,Coast Air,CA22,SFO,JFK,2586,H
    2025-12-05,Coast Air,CA21,JFK,SFO,2586,H
    2025-09-19,Example Air,EX42,FCO,LHR,897,H
    2025-09-12,Example Air,EX41,LHR,FCO,897,H
    2025-05-22,Pacific Air,PA8,SYD,SFO,7417,H
    2025-05-08,Pacific Air,PA7,SFO,SYD,7417,H
    2024-11-16,Coast Air,CA64,SEA,JFK,2421,H
    2024-11-09,Coast Air,CA63,JFK,SEA,2421,H
    2024-06-20,Example Air,?,AMS,LHR,231,L
    2024-06-16,Example Air,EX12,LHR,AMS,231,H
    2023-10-10,Pacific Air,PA36,SIN,LHR,6765,H
    2023-10-01,Pacific Air,PA35,LHR,SIN,6765,H
    2023-03-12,Coast Air,CA4,LAX,JFK,2475,M
    2023-03-05,Coast Air,CA3,JFK,LAX,2475,H
    2022-07-20,Example Air,EX60,BCN,LHR,713,H
    2022-07-13,Example Air,EX59,LHR,BCN,713,H
    """
}
