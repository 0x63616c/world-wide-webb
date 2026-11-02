import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LiveCalendarProviderTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1793381400)
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return value
    }
    private func fixture() throws -> [CalendarEvent] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("PanelKit/Tests/PanelKitTests/Fixtures/calendar/events.json")
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([CalendarEvent].self, from: Data(contentsOf: url))
    }
    private func provider(_ store: CalendarProviderStore) -> LiveCalendarProvider {
        let now = now, calendar = calendar
        return LiveCalendarProvider(api: CalendarAPI(store: store), now: { now }, calendar: { calendar })
    }

    func testFixtureMapsTodayUpcomingAllDayAndMissingMetadata() async throws {
        let store = CalendarProviderStore(values: try fixture())
        let provider = provider(store)
        XCTAssertTrue(provider.events.isEmpty)
        XCTAssertEqual(provider.availability, .loading)
        let initialReads = await store.reads
        XCTAssertTrue(initialReads.isEmpty)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.events.count, 7)
        XCTAssertEqual(provider.next(at: now)?.title, "Design workshop")
        XCTAssertEqual(provider.next(at: now)?.time, "11:00")
        let allDay = try XCTUnwrap(provider.events.first { $0.title == "Community day" })
        XCTAssertEqual(allDay.time, "All day")
        XCTAssertEqual(allDay.durationText, "All day")
        let tomorrow = try XCTUnwrap(provider.events.first { $0.id == "fixture_series@1793472000" })
        XCTAssertTrue(tomorrow.period.contains("Oct 31"))
        XCTAssertEqual(provider.events.last?.title, "Untitled event")
        XCTAssertEqual(provider.events.last?.location, "No location")
        XCTAssertEqual(Set(provider.events.map(\.id)).count, 7)
    }

    func testDateWindowUsesLocalMidnightAndCalendarDaysAcrossDST() async throws {
        let store = CalendarProviderStore(values: try fixture())
        let provider = provider(store)
        await provider.refresh()
        let reads = await store.reads
        let interval = try XCTUnwrap(reads.first)
        XCTAssertEqual(interval.start, calendar.startOfDay(for: now))
        XCTAssertEqual(interval.duration, 169 * 3600) // Fall-back week, not 7 * 24 hours.
        XCTAssertEqual(provider.events.first { $0.title == "Clock change check" }?.duration, 120)
        XCTAssertEqual(provider.events.first { $0.title == "Clock change check" }?.time, "1:30")
    }

    func testNextUsesAbsoluteEndIncludingOngoingOvernightAndTomorrow() async throws {
        let provider = provider(CalendarProviderStore(values: try fixture()))
        await provider.refresh()
        XCTAssertEqual(provider.next(at: Date(timeIntervalSince1970: 1793345400))?.title, "Overnight maintenance")
        XCTAssertEqual(provider.next(at: now.addingTimeInterval(3600))?.title, "Design workshop")
        XCTAssertEqual(provider.next(at: now.addingTimeInterval(7200))?.id, "fixture_series@1793472000")
        XCTAssertNil(provider.next(at: now.addingTimeInterval(7 * 86400)))
    }

    func testFiltersInvalidOutsideWindowAndDuplicatesThenSorts() async throws {
        let values = try fixture()
        let invalid = CalendarEvent(id: "bad", title: nil, location: nil, start: now, end: now, isAllDay: false)
        let future = CalendarEvent(id: "outside", title: nil, location: nil, start: now.addingTimeInterval(8 * 86400),
                                   end: now.addingTimeInterval(9 * 86400), isAllDay: false)
        let provider = provider(CalendarProviderStore(values: Array(values.reversed()) + [values[0], invalid, future]))
        await provider.refresh()
        XCTAssertEqual(provider.events.map(\.id), values.map(\.id))
    }

    func testDeniedAndFailureClearPrivateEventsAndRecover() async throws {
        let store = CalendarProviderStore(values: try fixture())
        let provider = provider(store)
        await provider.refresh()
        for access in [CalendarAccess.denied, .restricted, .writeOnly] {
            await store.setAccess(access)
            await provider.refresh()
            XCTAssertTrue(provider.events.isEmpty)
            XCTAssertNil(provider.next(at: now))
            XCTAssertEqual(provider.availability, .unavailable("Calendar access is off: allow in Settings"))
        }
        await store.setAccess(.fullAccess)
        await provider.refresh()
        XCTAssertEqual(provider.events.count, 7)
        await store.setFailure(true)
        await provider.refresh()
        XCTAssertTrue(provider.events.isEmpty)
        await store.setFailure(false)
        await provider.refresh()
        XCTAssertEqual(provider.events.count, 7)
    }

    func testEmptyFeedAndStopDoNotExposeMockEvents() async {
        let provider = provider(CalendarProviderStore(values: []))
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertTrue(provider.events.isEmpty)
        provider.stop()
        XCTAssertEqual(provider.availability, .unavailable("Calendar is unavailable."))
        XCTAssertNil(provider.next(at: now))
    }

    func testStoppedInFlightRefreshCannotRepublishPrivateEvents() async throws {
        let store = CalendarProviderStore(values: try fixture(), suspended: true)
        let provider = provider(store)
        let task = Task { await provider.refresh() }
        while await store.reads.isEmpty { await Task.yield() }
        provider.stop()
        await store.resume()
        await task.value
        XCTAssertTrue(provider.events.isEmpty)
        XCTAssertEqual(provider.availability, .unavailable("Calendar is unavailable."))
        await provider.refresh()
        XCTAssertEqual(provider.events.count, 7)
    }

    func testCancelledReadCannotPublishEvents() async throws {
        let store = CalendarProviderStore(values: try fixture(), suspended: true)
        let provider = provider(store)
        let task = Task { await provider.refresh() }
        while await store.reads.isEmpty { await Task.yield() }
        task.cancel()
        await store.resume()
        await task.value
        XCTAssertTrue(provider.events.isEmpty)
    }

    func testMockDefaultsAndLocalDateLabels() {
        let mock = MockCalendarProvider()
        XCTAssertEqual(mock.heading, "Today")
        XCTAssertEqual(mock.events.count, 4)
        XCTAssertEqual(mock.events[0].time, "9:00")
        XCTAssertEqual(mock.events[0].durationText, "45 min")
        let provider = provider(CalendarProviderStore(values: []))
        XCTAssertEqual(provider.dateText(at: Date(timeIntervalSince1970: 1793341800), format: "yyyy-MM-dd"), "2026-10-29")
    }
}

private actor CalendarProviderStore: CalendarEventStore {
    let values: [CalendarEvent]
    var access: CalendarAccess = .fullAccess
    var failure = false
    var suspended: Bool
    var continuation: CheckedContinuation<Void, Never>?
    private(set) var reads: [DateInterval] = []
    init(values: [CalendarEvent], suspended: Bool = false) { self.values = values; self.suspended = suspended }
    func setAccess(_ access: CalendarAccess) { self.access = access }
    func setFailure(_ failure: Bool) { self.failure = failure }
    func authorization() -> CalendarAccess { access }
    func requestFullAccess() -> Bool { false }
    func events(in interval: DateInterval) async throws -> [CalendarEvent] {
        reads.append(interval)
        if suspended { await withCheckedContinuation { continuation = $0 } }
        if failure { throw CalendarAPIError.unavailable }
        return values
    }
    func resume() { suspended = false; continuation?.resume(); continuation = nil }
}
