import AirMilesCore
import Foundation
import Observation

@MainActor @Observable final class FlightStore {
    private(set) var flights: [Flight] = []
    private(set) var airports: [String: Airport] = [:]
    private(set) var isDemo = false
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
    }

    var stats: FlightStats { FlightStats(flights: flights, airports: airports) }
    var filtered: [Flight] {
        flights.filter {
            (selectedYear == nil || $0.year == selectedYear) &&
            (!reviewOnly || $0.confidence != .high) && $0.matches(query, airports: airports)
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
    }
    private static func csv(for flights: [Flight]) -> String {
        func quote(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        return "date,airline,flight,from,to,miles,confidence\n" + flights.map {
            [$0.date, $0.airline, $0.number, $0.origin, $0.destination, String($0.miles), $0.confidence.rawValue].map(quote).joined(separator: ",")
        }.joined(separator: "\n")
    }

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
