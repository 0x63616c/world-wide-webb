import XCTest
@testable import AirMilesCore

final class EnrichmentTests: XCTestCase {
    private let record = #"""
    {"source":"Sample","sourceURL":"https://example.com","operatingCarrier":"EX","operatingFlightNumber":"1",
     "tailNumber":"N000EX","scheduledDeparture":"23:50","actualDeparture":"24:00",
     "scheduledArrival":"01:00","actualArrival":"00:52","departureDelay":10,"arrivalDelay":-8,
     "elapsedMinutes":52,"airborneMinutes":40,"cancelled":false,"diverted":false}
    """#

    func testEnrichmentSurvivesReimportButDoesNotAttachToDifferentIdentity() throws {
        let header = "date,airline,flight,from,to,miles,confidence\n"
        let flight = try XCTUnwrap(FlightCSV.parse(header + "2024-01-02,Example Air,EX1,LAX,SFO,337,M").first)
        let json = "{\"version\":1,\"retrievedAt\":\"2026-11-04\",\"latestMonth\":\"2026-08\",\"records\":{\"\(flight.enrichmentKey)\":\(record)}}"
        let enrichment = try FlightEnrichment.load(Data(json.utf8))
        let reimport = try FlightCSV.parse(header + "2024-01-03,Example Air,EX1,LAX,SFO,337,H\n2024-01-02,Example Air,EX1,LAX,SFO,337,M")
        XCTAssertNotNil(enrichment.operation(for: reimport[1]))
        XCTAssertNil(enrichment.operation(for: reimport[0]))
        XCTAssertEqual(reimport[1].confidence, .medium)
        XCTAssertEqual(enrichment.operation(for: flight)?.arrivalSummary, "Arrived 8 min early")
        XCTAssertThrowsError(try FlightEnrichment.load(Data(json.replacingOccurrences(of: "\"version\":1", with: "\"version\":2").utf8)))
    }

    func testCancelledAndDivertedDataCannotImplyArrivalOrDuration() throws {
        for field in ["cancelled", "diverted"] {
            let data = record.replacingOccurrences(of: "\"\(field)\":false", with: "\"\(field)\":true")
            let operation = try JSONDecoder().decode(FlightOperation.self, from: Data(data.utf8))
            XCTAssertNil(operation.safeArrival)
            XCTAssertNil(operation.duration)
            XCTAssertEqual(operation.arrivalSummary, field == "cancelled" ? "Cancelled" : "Diverted")
        }
    }
}
