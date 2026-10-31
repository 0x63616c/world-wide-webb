import XCTest
@testable import Panel

@MainActor final class NotificationBannerPresentationTests: XCTestCase {
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
        let old = center.post(sourceModule: "alarms", title: "Older critical", body: "", deepLink: "module/alarms", priority: .critical)
        now += 1
        let middle = center.post(sourceModule: "walk", title: "Middle", body: "", deepLink: "module/walk")
        now += 1
        let new = center.post(sourceModule: "walk", title: "Newest", body: "", deepLink: "module/walk")
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
