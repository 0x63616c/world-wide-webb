import Foundation
import XCTest
import PanelKit
@testable import Panel

@MainActor final class NotificationCenterTests: XCTestCase {
    func testLocalOrderingGroupingDedupeAndClear() async {
        let center = Panel.NotificationCenter()
        let first = center.post(sourceModule: "lights", title: "First", body: "", deepLink: "module/lights", dedupeKey: "scene")
        let duplicate = center.post(sourceModule: "lights", title: "Updated", body: "", deepLink: "module/lights", dedupeKey: "scene")
        XCTAssertEqual(first, duplicate)
        _ = center.post(sourceModule: "climate", title: "Critical", body: "", deepLink: "module/climate", priority: .critical)
        _ = center.post(sourceModule: "lights", title: "Other", body: "", deepLink: "module/lights")
        XCTAssertEqual(center.history.count, 3)
        XCTAssertEqual(center.history.first?.title, "Critical")
        XCTAssertEqual(center.groups.map(\.items.count), [1, 2])
        await center.clear(sourceModule: "lights")
        XCTAssertEqual(center.history.count, 1)
        await center.clear()
        XCTAssertTrue(center.history.isEmpty)
    }

    func testTimingTouchQueueAndCriticalPersistence() async {
        let center = Panel.NotificationCenter()
        let normal = center.post(sourceModule: "lights", title: "Normal", body: "", deepLink: "module/lights")
        _ = center.post(sourceModule: "climate", title: "High", body: "", deepLink: "module/climate", priority: .high)
        _ = center.post(sourceModule: "alarms", title: "Critical", body: "", deepLink: "module/alarms", priority: .critical)
        center.advanceBanners(by: 100, visibleSources: [])
        XCTAssertEqual(center.bannerGroups.count, 3)
        center.setTouched("lights", true)
        center.advanceBanners(by: 6, visibleSources: ["lights", "climate", "alarms"])
        XCTAssertEqual(center.bannerGroups.count, 3)
        center.setTouched("lights", false)
        center.advanceBanners(by: 5, visibleSources: ["lights", "climate", "alarms"], paused: true)
        XCTAssertEqual(center.bannerGroups.count, 3)
        center.advanceBanners(by: 5, visibleSources: ["lights", "climate", "alarms"])
        XCTAssertEqual(center.bannerGroups.map(\.sourceModule), ["alarms"])
        XCTAssertTrue(center.history.contains { $0.id == normal })
        await center.open(normal)
        XCTAssertEqual(center.unreadCount, 2)
        XCTAssertEqual(center.openFeedback, 1)
    }

    func testRemotePaginationDedupeTombstonesAndRead() async throws {
        let row = try notificationRow(revision: "1")
        let read = try notificationRow(revision: "2", read: true)
        let dismissed = try notificationRow(revision: "3", dismissed: true)
        let api = NotificationStub(pages: [NotificationPage(items: [row], cursor: "1", hasMore: true),
            NotificationPage(items: [read], cursor: "2", hasMore: false),
            NotificationPage(items: [dismissed], cursor: "3", hasMore: false)], row: dismissed)
        let center = Panel.NotificationCenter(api: api)
        center.post(sourceModule: "lights", title: "Remote", body: "Body", deepLink: "module/lights", dedupeKey: "scene")
        await center.refresh()
        XCTAssertEqual(center.history.count, 1)
        XCTAssertEqual(center.history.first?.id, "ntf_synthetic")
        XCTAssertTrue(center.bannerGroups.isEmpty)
        XCTAssertEqual(center.cursor, "2")
        XCTAssertEqual(center.arrivalFeedback, 1)
        await center.refresh()
        XCTAssertTrue(center.history.isEmpty)
        let cursors = await api.cursors
        XCTAssertEqual(cursors, [nil, "1", "2"])
    }

    func testAbsentEndpointKeepsLocalServiceAndClearWorking() async throws {
        let api = NotificationStub(pages: [], row: try notificationRow(revision: "1"))
        let center = Panel.NotificationCenter(api: api)
        center.post(sourceModule: "lights", title: "Local", body: "", deepLink: "module/lights")
        await center.refresh()
        XCTAssertEqual(center.connection, .unavailable)
        XCTAssertEqual(center.history.count, 1)
        await center.clear()
        XCTAssertTrue(center.history.isEmpty)
    }

    func testFailedDismissRestoresBannerAndError() async throws {
        let api = NotificationStub(pages: [NotificationPage(items: [try notificationRow(revision: "1")], cursor: "1", hasMore: false)],
            row: nil)
        let center = Panel.NotificationCenter(api: api)
        await center.refresh()
        await center.dismiss("ntf_synthetic")
        XCTAssertEqual(center.bannerGroups.count, 1)
        XCTAssertNotNil(center.lastError)
    }

    func testSameRevisionDoesNotReplayAndRecoveryRetainsHistory() async throws {
        let row = try notificationRow(revision: "1")
        let api = NotificationStub(pages: [NotificationPage(items: [row], cursor: "1", hasMore: false)], row: row)
        let center = Panel.NotificationCenter(api: api)
        await center.refresh()
        center.hideBanner(row.id)
        await center.refresh() // absent endpoint, retain already received history
        XCTAssertEqual(center.connection, .unavailable)
        XCTAssertEqual(center.history.count, 1)
        await api.append(NotificationPage(items: [row], cursor: "1", hasMore: false))
        await center.refresh()
        XCTAssertEqual(center.connection, .connected)
        XCTAssertTrue(center.bannerGroups.isEmpty)
        XCTAssertEqual(center.arrivalFeedback, 1)
    }

    func testRetentionResetsCursorAndRemoteCacheButKeepsLocal() async throws {
        let clock = NotificationTestClock()
        let row = try notificationRow(revision: "1")
        let api = NotificationStub(pages: [NotificationPage(items: [row], cursor: "1", hasMore: false),
            NotificationPage(items: [], cursor: "0", hasMore: false)], row: row)
        let center = Panel.NotificationCenter(api: api, now: { clock.date })
        await center.refresh()
        center.post(sourceModule: "climate", title: "Local", body: "", deepLink: "module/climate")
        clock.date = clock.date.addingTimeInterval(31 * 86_400)
        await center.refresh()
        XCTAssertEqual(center.history.map(\.sourceModule), ["climate"])
        let cursors = await api.cursors
        XCTAssertEqual(cursors, [nil, nil])
    }

    func testDedupeUpdateInSameMillisecondPresentsChangedContent() async throws {
        let api = NotificationStub(pages: [
            NotificationPage(items: [try notificationRow(revision: "1")], cursor: "1", hasMore: false),
            NotificationPage(items: [try notificationRow(revision: "2", title: "Updated")], cursor: "2", hasMore: false)
        ], row: nil)
        let center = Panel.NotificationCenter(api: api)
        await center.refresh()
        center.hideBanner("ntf_synthetic")
        await center.refresh()
        XCTAssertEqual(center.history.count, 1)
        XCTAssertEqual(center.bannerGroups.first?.items.first?.title, "Updated")
        XCTAssertEqual(center.arrivalFeedback, 2)
    }

    func testSourceDedupeIsolationAndTimeOrdering() {
        let clock = NotificationTestClock()
        let center = Panel.NotificationCenter(now: { clock.date })
        center.post(sourceModule: "lights", title: "Older", body: "", deepLink: "module/lights", dedupeKey: "same")
        clock.date = clock.date.addingTimeInterval(1)
        center.post(sourceModule: "climate", title: "Newer", body: "", deepLink: "module/climate", dedupeKey: "same")
        XCTAssertEqual(center.history.map(\.title), ["Newer", "Older"])
        XCTAssertEqual(center.groups.count, 2)
    }

    func testPresenterOwnershipReturnsToUnderlyingSurface() {
        let center = Panel.NotificationCenter()
        let root = UUID(), cover = UUID()
        center.registerPresenter(root)
        XCTAssertTrue(center.isActivePresenter(root))
        center.registerPresenter(cover)
        XCTAssertFalse(center.isActivePresenter(root))
        XCTAssertTrue(center.isActivePresenter(cover))
        center.setTouched("lights", true)
        center.unregisterPresenter(cover)
        XCTAssertTrue(center.isActivePresenter(root))
        center.post(sourceModule: "lights", title: "Ready", body: "", deepLink: "module/lights")
        center.advanceBanners(by: 5, visibleSources: ["lights"])
        XCTAssertTrue(center.bannerGroups.isEmpty) // Disappearing touched surfaces cannot leave timers paused.
        center.unregisterPresenter(root)
        XCTAssertFalse(center.isActivePresenter(root))
    }

    func testOpenHandlerKeepsUnknownRoutesUnread() async {
        let center = Panel.NotificationCenter()
        let id = center.post(sourceModule: "unknown", title: "Ready", body: "", deepLink: "module/unknown")
        center.setOpenHandler { _ in false }
        await center.open(id)
        XCTAssertEqual(center.unreadCount, 1)
        XCTAssertEqual(center.bannerGroups.count, 1)
        XCTAssertEqual(center.openFeedback, 0)
        center.setOpenHandler { _ in true }
        await center.open(id)
        XCTAssertEqual(center.unreadCount, 0)
        XCTAssertTrue(center.bannerGroups.isEmpty)
        XCTAssertEqual(center.openFeedback, 1)
    }

    func testRoutesAndGestures() {
        XCTAssertEqual(PanelNotifications.module(for: "module/events/alarms"), .alarms)
        XCTAssertEqual(PanelNotifications.module(for: "module/ctrl"), .lights)
        XCTAssertNil(PanelNotifications.module(for: "module/wakes")) // Activity is not Dog Walk.
        XCTAssertNil(PanelNotifications.module(for: "module/unknown"))
        XCTAssertNil(PanelNotifications.module(for: "module/lights/../alarms"))
        XCTAssertNil(PanelNotifications.module(for: "https://example.com"))
        XCTAssertTrue(NotificationBannerGesture.dismisses(x: 80, y: 0))
        XCTAssertTrue(NotificationBannerGesture.dismisses(x: -80, y: 0))
        XCTAssertTrue(NotificationBannerGesture.dismisses(x: 0, y: -60))
        XCTAssertFalse(NotificationBannerGesture.dismisses(x: 5, y: 60))
    }
}

private func notificationRow(revision: String, read: Bool = false, dismissed: Bool = false, title: String = "Remote") throws -> PanelNotification {
    let date = "2026-10-30T12:00:00.000Z"
    let json: [String: Any] = ["id": "ntf_synthetic", "source_module": "lights", "title": title, "body": "Body",
        "deep_link": "module/lights", "priority": "normal", "dedupe_key": "scene", "created_at": date,
        "updated_at": date, "read_at": read ? date as Any : NSNull(),
        "dismissed_at": dismissed ? date as Any : NSNull(), "revision": revision]
    return try JSONDecoder().decode(PanelNotification.self, from: JSONSerialization.data(withJSONObject: json))
}

private actor NotificationStub: NotificationsServing {
    var pages: [NotificationPage]
    var cursors: [String?] = []
    let row: PanelNotification?
    init(pages: [NotificationPage], row: PanelNotification?) { self.pages = pages; self.row = row }
    func append(_ page: NotificationPage) { pages.append(page) }
    func list(since: String?) async throws -> NotificationPage {
        cursors.append(since)
        guard !pages.isEmpty else { throw PanelAPIError.http(status: 404) }
        return pages.removeFirst()
    }
    func markRead(id: String) throws -> PanelNotification { guard let row else { throw PanelAPIError.http(status: 503) }; return row }
    func dismiss(id: String) throws -> PanelNotification { guard let row else { throw PanelAPIError.http(status: 503) }; return row }
    func dismissAll() throws -> Int { throw PanelAPIError.http(status: 404) }
}

@MainActor private final class NotificationTestClock { var date = Date(timeIntervalSince1970: 1_800_000_000) }
