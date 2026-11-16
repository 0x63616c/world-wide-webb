import XCTest

@testable import Panel

final class CalendarDayLayoutTests: XCTestCase {
    func testSeparateEventsKeepTheFullWidth() {
        let slots = DayTimeline.slots([("b", 660, 750), ("a", 540, 600)])
        XCTAssertEqual(
            slots,
            [
                DayTimelineSlot(id: "a", start: 540, end: 600, column: 0, columns: 1),
                DayTimelineSlot(id: "b", start: 660, end: 750, column: 0, columns: 1),
            ])
    }

    func testOverlappingEventsShareColumnsAndReuseFreedOnes() {
        // a overlaps b and c; c starts after b ends, so it reuses b's column.
        let slots = DayTimeline.slots([("a", 540, 720), ("b", 560, 620), ("c", 630, 700)])
        XCTAssertEqual(slots.map(\.column), [0, 1, 1])
        XCTAssertEqual(slots.map(\.columns), [2, 2, 2])
    }

    func testShortEventReservesMinimumRoom() {
        let slots = DayTimeline.slots([("a", 600, 605), ("b", 615, 660)])
        XCTAssertEqual(slots[0].end, 630)
        XCTAssertEqual(slots.map(\.column), [0, 1])
    }
}
