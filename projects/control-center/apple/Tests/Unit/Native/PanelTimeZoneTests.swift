import PanelKit
import XCTest

@testable import Panel

@MainActor final class PanelTimeZoneTests: XCTestCase {
    private let instant = ISO8601DateFormatter().date(from: "2026-10-30T05:30:00Z")!  // 22:30 PDT on Oct 29

    func testResolveDefaultsToLosAngeles() {
        XCTAssertEqual(PanelTimeZone.resolve(nil).identifier, "America/Los_Angeles")
        XCTAssertEqual(PanelTimeZone.resolve("Not/AZone").identifier, "America/Los_Angeles")
        XCTAssertEqual(PanelTimeZone.resolve("Europe/London").identifier, "Europe/London")
    }

    func testDayBoundaryFollowsSelectedZone() {
        let la = PanelTimeZone.calendar(for: PanelTimeZone.resolve("America/Los_Angeles"))
        let london = PanelTimeZone.calendar(for: PanelTimeZone.resolve("Europe/London"))
        XCTAssertEqual(la.component(.day, from: instant), 29)
        XCTAssertEqual(london.component(.day, from: instant), 30)
        XCTAssertEqual(fixtureTime(instant, format: "EEE h:mm a", timeZone: la.timeZone), "Thu 10:30 PM")
        XCTAssertEqual(fixtureTime(instant, format: "EEE h:mm a", timeZone: london.timeZone), "Fri 5:30 AM")
    }

    func testWeatherHoursAreLabelledInSelectedZone() throws {
        let hours = try JSONDecoder().decode(
            [WeatherHour].self,
            from: Data(
                #"""
                [{"t":"Now","temp":60,"feels":59,"ic":"moon","isDay":false,"isoTime":"2026-10-30T05:00:00.000000Z","weatherCode":0},
                 {"t":"11","temp":60,"feels":59,"ic":"moon","isDay":false,"isoTime":"2026-10-30T06:00:00.000000Z","weatherCode":0}]
                """#.utf8))
        let london = PanelTimeZone.resolve("Europe/London")
        XCTAssertEqual(LiveWeatherSnapshot.hourLabel(hours[0], index: 0, timeZone: london), "Now")
        XCTAssertEqual(
            LiveWeatherSnapshot.hourLabel(hours[1], index: 1, timeZone: PanelTimeZone.resolve(nil)), "11")
        XCTAssertEqual(LiveWeatherSnapshot.hourLabel(hours[1], index: 1, timeZone: london), "6")
    }
}
