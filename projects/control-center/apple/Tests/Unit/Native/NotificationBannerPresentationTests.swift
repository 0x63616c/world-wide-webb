import XCTest

@testable import Panel

@MainActor final class NotificationBannerPresentationTests: XCTestCase {
    func testAgeUsesOnlyLargestCompletedUnit() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = calendar.date(from: DateComponents(year: 2026, month: 1, day: 1))!
        for (elapsed, expected) in [
            (-1.0, DateComponents()), (59, DateComponents()),
            (60, DateComponents(minute: 1)), (3599, DateComponents(minute: 59)),
            (3600, DateComponents(hour: 1)), (7199, DateComponents(hour: 1)),
            (86399, DateComponents(hour: 23)), (86400, DateComponents(day: 1)),
            (604800, DateComponents(weekOfMonth: 1)),
            (31 * 86400, DateComponents(month: 1)),
            (365 * 86400, DateComponents(year: 1)),
        ] {
            XCTAssertEqual(NotificationAge.components(from: start, to: start + elapsed, calendar: calendar), expected)
        }
    }

    func testCompactRelativeAges() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(NotificationAge.formatted(from: now - 60, to: now), "1m ago")
        XCTAssertEqual(NotificationAge.formatted(from: now - 7200, to: now), "2h ago")
        XCTAssertEqual(NotificationAge.formatted(from: now - 10, to: now), "Now")
    }

    func testOpenAppSuppressesBannersWithoutLosingHistoryOrReplayingOnClose() {
        let center = Panel.NotificationCenter()
        let old = center.post(sourceModule: "sound", title: "Sonos", body: "", deepLink: "module/sound")
        center.setVisibleSources(PanelNotifications.sources(for: "music"))
        XCTAssertTrue(center.bannerGroups.isEmpty)
        let feedback = center.arrivalFeedback
        center.post(sourceModule: "sonos", title: "Volume updated", body: "", deepLink: "module/sonos")
        XCTAssertEqual(center.arrivalFeedback, feedback)
        XCTAssertTrue(center.bannerGroups.isEmpty)
        XCTAssertTrue(center.history.contains { $0.id == old })
        center.post(sourceModule: "climate", title: "Ready", body: "", deepLink: "module/climate")
        XCTAssertEqual(center.bannerGroups.map(\.id), ["climate"])
        center.setVisibleSources([])
        XCTAssertEqual(center.bannerGroups.map(\.id), ["climate"])
        XCTAssertEqual(center.history.count, 3)
        XCTAssertTrue(PanelNotifications.sources(for: "lights").contains("ctrl"))
        XCTAssertTrue(PanelNotifications.sources(for: "timer").contains("timer"))
        XCTAssertTrue(PanelNotifications.sources(for: "booth").contains("photos"))
    }

    func testRightDragAndFlingOnly() {
        XCTAssertTrue(NotificationBannerGesture.dismisses(x: 90, y: 5))
        XCTAssertTrue(NotificationBannerGesture.dismisses(x: 25, y: 3, predictedX: 220))
        XCTAssertFalse(NotificationBannerGesture.dismisses(x: 35, y: 2, predictedX: 60))
        XCTAssertFalse(NotificationBannerGesture.dismisses(x: -150, y: 0, predictedX: -350))
        XCTAssertFalse(NotificationBannerGesture.dismisses(x: 100, y: -180, predictedX: 230))
        XCTAssertFalse(NotificationBannerGesture.dismisses(x: 2, y: 0, predictedX: 230))
    }

    func testLeftRubberBandAndRightTracking() {
        XCTAssertEqual(NotificationBannerGesture.offset(125), 125)
        XCTAssertLessThan(NotificationBannerGesture.offset(-80), 0)
        XCTAssertGreaterThan(NotificationBannerGesture.offset(-800), -24)
        XCTAssertEqual(NotificationBannerGesture.offset(0), 0)
    }

    func testNewestStackAndHiddenItemsKeepReadingTimeAndHistory() {
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let center = Panel.NotificationCenter(now: { now })
        let old = center.post(
            sourceModule: "alarms", title: "Older critical", body: "", deepLink: "module/alarms", priority: .critical)
        now += 1
        let middle = center.post(sourceModule: "calendar", title: "Middle", body: "", deepLink: "module/calendar")
        now += 1
        let new = center.post(sourceModule: "calendar", title: "Newest", body: "", deepLink: "module/calendar")
        XCTAssertEqual(NotificationBannerStack.ordered(center.bannerGroups).map(\.id), [new, middle, old])
        XCTAssertEqual(NotificationBannerStack.peekCount(0), 0)
        XCTAssertEqual(NotificationBannerStack.peekCount(2), 1)
        XCTAssertEqual(NotificationBannerStack.peekCount(20), 2)
        center.advanceBanners(by: 30, visibleIDs: [new], paused: true)
        XCTAssertEqual(NotificationBannerStack.ordered(center.bannerGroups).count, 3)
        center.advanceBanners(by: 5, visibleIDs: [new])
        XCTAssertEqual(NotificationBannerStack.ordered(center.bannerGroups).map(\.id), [middle, old])
        center.hideBanner(middle)
        XCTAssertEqual(center.history.count, 3)
        XCTAssertEqual(center.unreadCount, 3)
    }
}
