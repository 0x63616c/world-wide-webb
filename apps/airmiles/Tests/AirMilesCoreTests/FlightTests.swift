import XCTest
@testable import AirMilesCore

final class FlightTests: XCTestCase {
    let header = "date,airline,flight,from,to,miles,source_uid,confidence\n"
    func testImportPreservesUncertaintyAndDuplicateLegsWithoutMailboxIDs() throws {
        let row = "2024-03-04,Example Air,?,LHR,JFK,3451,private-source,M\n"
        let flights = try FlightCSV.parse(header + row + row)
        XCTAssertEqual(flights.count, 2)
        XCTAssertNotEqual(flights[0].id, flights[1].id)
        XCTAssertEqual(flights[0].flightNumber, "Not recorded")
        XCTAssertEqual(flights[0].confidence, .medium)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(flights), as: UTF8.self).contains("private-source"))
    }
    func testQuotedFieldsAndCRLF() throws {
        let csv = header + "2025-01-01,\"Example, \"\"Air\"\"\",EA1,JFK,LHR,3451,email,H\n"
        let flights = try FlightCSV.parse(csv.replacingOccurrences(of: "\n", with: "\r\n"))
        XCTAssertEqual(flights.first?.airline, "Example, \"Air\"")
    }
    func testInvalidImportNeverPartiallySucceeds() {
        for row in ["2025-02-30,Air,A1,JFK,LHR,3451,x,H", "2025-02-01,Air,A1,JFK,LHR,-2,x,H", "2025-02-01,Air,A1,JFK,LHR,3451,x,X", "2025-02-01,Air,A1,JFK,JFK,3451,x,H", "2025-02-01,\"Air,A1,JFK,LHR,3451,x,H"] {
            XCTAssertThrowsError(try FlightCSV.parse(header + "2025-01-01,Air,A1,JFK,LHR,3451,x,H\n" + row))
        }
        XCTAssertThrowsError(try FlightCSV.parse(header))
    }
    func testStatsSearchAndSorting() throws {
        let flights = try FlightCSV.parse(header + "2024-03-04,Example Air,EA1,LHR,JFK,3451,x,H\n2025-01-01,Example Air,EA2,JFK,LHR,3451,y,L")
        let stats = FlightStats(flights: flights, airports: [:])
        XCTAssertEqual(flights.first?.year, "2025")
        XCTAssertEqual(stats.miles, 6902)
        XCTAssertEqual(stats.airportCodes.count, 2)
        XCTAssertEqual(stats.routes, 1)
        XCTAssertEqual(stats.needsReview, 1)
        XCTAssertTrue(flights[0].matches("jfk 2025", airports: [:]))
        XCTAssertFalse(flights[0].matches("jfk 2024", airports: [:]))
    }
    func testCalendarDateDoesNotShiftWithDeviceTimeZone() throws {
        let flight = try XCTUnwrap(FlightCSV.parse(header + "2025-01-01,Example Air,EA1,JFK,LHR,3451,x,H").first)
        let original = NSTimeZone.default
        defer { NSTimeZone.default = original }
        NSTimeZone.default = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let pacific = flight.displayDate
        NSTimeZone.default = try XCTUnwrap(TimeZone(identifier: "Asia/Tokyo"))
        XCTAssertEqual(pacific, flight.displayDate)
        XCTAssertEqual(flight.date, "2025-01-01")
    }
}
