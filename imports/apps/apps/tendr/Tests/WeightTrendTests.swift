import XCTest
@testable import StillCore

final class WeightTrendTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_767_571_200) // Monday 5 January 2026, 00:00 UTC
    private func day(_ offset: Double, _ kilograms: Double) -> WeightEntry {
        WeightEntry(date: start.addingTimeInterval(offset * 86400 + 8 * 3600), kilograms: kilograms)
    }
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 2
        return calendar
    }

    func testNewJournalFollowsTheSystemAppearanceAndASevenDayTrend() throws {
        XCTAssertEqual(Journal().appearance, "system")
        XCTAssertEqual(Journal().weightTrend, .sevenDay)
        let older = try JSONDecoder().decode(Journal.self, from: Data(#"{"version":1}"#.utf8))
        XCTAssertEqual(older.appearance, "system")
        XCTAssertEqual(older.weightTrend, .sevenDay)
    }

    func testSavedChoicesSurviveAndUnknownModesFallBack() throws {
        var journal = Journal()
        journal.appearance = "dark"
        journal.weightTrend = .smoothed
        let reloaded = try JSONDecoder().decode(Journal.self, from: JSONEncoder().encode(journal))
        XCTAssertEqual(reloaded.appearance, "dark")
        XCTAssertEqual(reloaded.weightTrend, .smoothed)
        let future = try JSONDecoder().decode(Journal.self, from: Data(#"{"version":1,"weightTrend":"lunar"}"#.utf8))
        XCTAssertEqual(future.weightTrend, .sevenDay)
    }

    func testRawReadingsAreUnchangedAndInDateOrder() {
        let readings = [day(2, 81), day(0, 80), day(1, 82)]
        XCTAssertEqual(WeightTrendMode.raw.trend(readings).map(\.kilograms), [80, 82, 81])
    }

    func testRollingAveragesUseACentredWindow() {
        let readings = (0..<10).map { day(Double($0), Double($0)) }
        // Day 5 sees days 2...8 within ±3.5 days.
        XCTAssertEqual(WeightTrendMode.sevenDay.trend(readings)[5].kilograms, 5, accuracy: 1e-9)
        // ±7 days covers every reading from day 0 to day 9 around day 5.
        XCTAssertEqual(WeightTrendMode.fourteenDay.trend(readings)[5].kilograms, 4.5, accuracy: 1e-9)
    }

    func testLongerWindowsSmoothDailyNoiseMore() {
        let readings = (0..<60).map { day(Double($0), 80 + ($0.isMultiple(of: 2) ? 1 : -1)) }
        func spread(_ mode: WeightTrendMode) -> Double {
            let values = mode.trend(readings).dropFirst(15).dropLast(15).map(\.kilograms)
            return (values.max() ?? 0) - (values.min() ?? 0)
        }
        XCTAssertLessThan(spread(.thirtyDay), spread(.sevenDay))
        XCTAssertLessThan(spread(.sevenDay), spread(.raw))
    }

    func testWeeklyAverageGivesOnePointPerCalendarWeek() {
        let readings = [day(0, 80), day(3, 82), day(6, 84), day(7, 70), day(9, 72)]
        let weeks = WeightTrendMode.weekly.trend(readings, calendar: utc)
        XCTAssertEqual(weeks.map(\.kilograms), [82, 71])
        XCTAssertEqual(weeks[0].date, day(3, 0).date, "Plotted at the mean time of that week's readings")
    }

    func testSmoothedTrendFollowsAStepGradually() {
        let readings = (0..<10).map { day(Double($0), 80) } + [day(10, 70)]
        let trend = WeightTrendMode.smoothed.trend(readings)
        XCTAssertEqual(trend[9].kilograms, 80, accuracy: 1e-9)
        XCTAssertEqual(trend[10].kilograms, 79, accuracy: 1e-9, "Moves 10% of the way after one day")
        let afterGap = WeightTrendMode.smoothed.trend([day(0, 80), day(10, 70)])
        XCTAssertEqual(afterGap[1].kilograms, 80 - 10 * (1 - pow(0.9, 10)), accuracy: 1e-9, "A ten-day gap counts as ten days of smoothing")
    }
}
