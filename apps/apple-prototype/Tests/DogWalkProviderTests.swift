import XCTest
@testable import WorldWideWebb

@MainActor final class DogWalkProviderTests: XCTestCase {
    let now = ISO8601DateFormatter().date(from: "2026-10-29T17:10:30Z")!
    func testStartIsIdempotentAndStopRecordsExactlyOneElapsedWalk() {
        let provider = MockWalkProvider(now: now, fixtures: false)
        provider.start(at: now)
        let id = provider.activeWalk?.id
        provider.start(at: now.addingTimeInterval(30))
        XCTAssertEqual(provider.activeWalk?.id, id)
        XCTAssertEqual(provider.activeWalk?.duration(at: now.addingTimeInterval(90)), 90)
        provider.stop(at: now.addingTimeInterval(1920))
        provider.stop(at: now.addingTimeInterval(2000))
        XCTAssertNil(provider.activeWalk)
        XCTAssertEqual(provider.history.count, 1)
        XCTAssertEqual(provider.history.first?.duration(at: now), 1920)
        XCTAssertEqual(provider.summary(at: now.addingTimeInterval(1920)).weeklyMinutes, 32)
        XCTAssertEqual(provider.summary(at: now.addingTimeInterval(1920)).averageMinutes, 32)
        XCTAssertEqual(provider.summary(at: now.addingTimeInterval(1920)).streak, 1)
    }
    func testFixturesCoverThreeWeeksAndThirtyDayChartIncludesEmptyDays() {
        let provider = MockWalkProvider(now: now)
        XCTAssertEqual(provider.lastWalkLabel(at: now), "Last walk 3h ago")
        XCTAssertEqual(provider.history.first?.duration(at: now), 32 * 60)
        XCTAssertEqual(provider.history.count, 19)
        let days = provider.days(30, ending: now)
        XCTAssertEqual(days.count, 30)
        XCTAssertEqual(Set(days.map(\.id)).count, 30)
        XCTAssertTrue(days.prefix(9).allSatisfy { $0.minutes == 0 })
        XCTAssertEqual(provider.days(7, ending: now).count, 7)
        XCTAssertEqual(provider.summary(at: now).streak, 8)
        XCTAssertEqual(provider.summary(at: now).weeklyMinutes, 133)
    }
    func testSharedActiveWalkDerivesElapsedFromServerStartAndStopsOnEitherDevice() {
        let backend = MockWalkBackend(now: now, fixtures: false)
        let phone = MockWalkProvider(now: now, device: .iPhone, backend: backend)
        let panel = MockWalkProvider(now: now, device: .iPad, backend: backend)
        phone.start(at: now.addingTimeInterval(-724))
        XCTAssertEqual(panel.activeWalk, phone.activeWalk)
        XCTAssertEqual(panel.activeWalk?.startedBy, .iPhone)
        XCTAssertEqual(panel.activeWalk?.duration(at: now), 724)
        XCTAssertEqual(phone.activeWalk?.duration(at: now.addingTimeInterval(36)), 760)
        panel.start(at: now) // A second device cannot reset a running walk.
        XCTAssertEqual(panel.activeWalk?.startedAt, now.addingTimeInterval(-724))
        panel.stop(at: now)
        XCTAssertNil(phone.activeWalk)
        XCTAssertEqual(phone.history, panel.history)
        XCTAssertEqual(phone.history.count, 1)
        XCTAssertEqual(phone.history.first?.duration(at: now.addingTimeInterval(600)), 724)
        phone.stop(at: now.addingTimeInterval(1))
        XCTAssertEqual(panel.history.count, 1)
    }
    func testRemoteFixtureEventsUseSameCommandAndHistoryPath() {
        let provider = MockWalkProvider(now: now, fixtures: false)
        provider.simulateRemoteStart(at: now.addingTimeInterval(-724))
        XCTAssertEqual(provider.activeWalk?.startedBy, .iPhone)
        XCTAssertEqual(provider.activeWalk?.duration(at: now), 724)
        provider.simulateRemoteStop(at: now)
        XCTAssertNil(provider.activeWalk)
        XCTAssertEqual(provider.history.first?.duration(at: now), 724)
        XCTAssertEqual(provider.history.first?.startedBy, .iPhone)
    }
    func testBackwardClockCannotProduceNegativeDuration() {
        let provider = MockWalkProvider(now: now, fixtures: false)
        provider.start(at: now)
        provider.stop(at: now.addingTimeInterval(-100))
        XCTAssertEqual(provider.history.first?.duration(at: now), 0)
        XCTAssertEqual(walkElapsed(754), "12:34")
        XCTAssertEqual(walkElapsed(3674), "1:01:14")
    }
}
