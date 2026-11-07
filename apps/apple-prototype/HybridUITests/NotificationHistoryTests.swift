import XCTest

final class NotificationHistoryTests: XCTestCase {
    @MainActor func testPullDownExpandSwipeClearAndClose() {
        continueAfterFailure = false
        let app = launch()
        capture("notification-v2-banners", app)
        openHistory(app)
        capture("notification-v2-history", app)
        XCTAssertFalse(app.staticTexts["Clear All"].exists)
        XCTAssertGreaterThanOrEqual(app.buttons["notification-history-clear-all"].frame.width, 44)
        XCTAssertEqual(rows(app).count, 2) // One exposed notification per module.
        app.buttons["notification-history-group-lights"].tap()
        XCTAssertEqual(rows(app).count, 4)
        capture("notification-v2-expanded", app)
        app.buttons["notification-history-group-lights"].tap()
        XCTAssertEqual(rows(app).count, 2)
        app.buttons["notification-history-group-lights"].tap()
        let row = rows(app).matching(NSPredicate(format: "label CONTAINS %@", "Reading scene")).firstMatch
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).press(forDuration: 0.05,
            thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.5)))
        app.buttons["Clear"].firstMatch.tap()
        let remaining = rows(app)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in remaining.count == 3 }, object: app)], timeout: 10), .completed)
        app.buttons["notification-history-clear-lights"].tap()
        XCTAssertTrue(app.buttons["notification-history-group-lights"].waitForNonExistence(timeout: 10))
        XCTAssertEqual(rows(app).count, 1)
        app.buttons["notification-history-clear-all"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["notification-history-empty"].firstMatch.waitForExistence(timeout: 10))
        capture("notification-v2-empty", app)
        let handle = app.buttons["notification-history-handle"]
        let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -180)))
        XCTAssertTrue(app.buttons["notification-history-close"].waitForNonExistence(timeout: 10))
    }

    @MainActor func testPersistedHistoryDeepLinksAbovePresentedController() {
        continueAfterFailure = false
        let app = launch()
        app.terminate()
        app.launchArguments.removeAll { ["-notificationResetCache", "-notificationSamples", "-notificationStack"].contains($0) }
        app.launch()
        app.alignPanelOrientation()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["notification-banner-lights"].exists)
        app.openHomeModule("climate")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More")).firstMatch.waitForExistence(timeout: 20))
        // Restored history remains discoverable even when no banners are live.
        let inbox = app.buttons["notification-open-history"]
        XCTAssertTrue(inbox.waitForExistence(timeout: 10))
        inbox.tap()
        XCTAssertTrue(app.buttons["notification-history-close"].waitForExistence(timeout: 10))
        XCTAssertEqual(rows(app).count, 2)
        capture("WWW-60-restored-over-controller", app)
        rows(app).matching(NSPredicate(format: "label CONTAINS %@", "Reading scene")).firstMatch.tap()
        XCTAssertTrue(app.buttons["notification-history-close"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.buttons["controller-toggle-bedroom"].waitForExistence(timeout: 20))
        capture("WWW-60-deep-link", app)
    }

    @MainActor func testBannerControlsAndClosingPreserveHistory() {
        continueAfterFailure = false
        let app = launch()
        app.buttons["notification-stack-expand"].tap()
        XCTAssertTrue(app.buttons["notification-stack-collapse"].waitForExistence(timeout: 5))
        capture("notification-v2-banner-stack", app)
        app.buttons["notification-dismiss-climate"].tap()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForNonExistence(timeout: 5))
        app.buttons["notification-open-history"].tap()
        XCTAssertTrue(app.buttons["notification-history-close"].waitForExistence(timeout: 5))
        // Hiding a banner is distinct from clearing the saved notification.
        XCTAssertTrue(rows(app).matching(NSPredicate(format: "label CONTAINS %@", "Temperature reached")).firstMatch.exists)
        app.buttons["notification-history-close"].tap()
        XCTAssertTrue(app.buttons["notification-history-close"].waitForNonExistence(timeout: 5))
        openHistory(app)
        XCTAssertEqual(rows(app).count, 2)
        capture("notification-v2-reopened", app)
    }

    @MainActor func testLargeTextHistoryAndReduceMotion() {
        continueAfterFailure = false
        let app = launch(extraArguments: ["-notificationReduceMotion", "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"])
        openHistory(app)
        XCTAssertTrue(app.buttons["notification-history-close"].isHittable)
        XCTAssertTrue(app.buttons["notification-history-clear-all"].isHittable)
        XCTAssertTrue(rows(app).firstMatch.isHittable)
        capture("notification-v2-accessibility", app)
        app.buttons["notification-history-close"].tap()
        XCTAssertTrue(app.buttons["notification-history-close"].waitForNonExistence(timeout: 5))
    }

    @MainActor private func launch(extraArguments: [String] = []) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-updateCheckFakeBuild", "1", "-moduleFlag.lights", "native",
            "-moduleFlag.climate", "native", "-notificationSamples", "-notificationStack", "-notificationHold",
            "-notificationPersistentCache", "-notificationResetCache"] + extraArguments
        app.launch()
        app.alignPanelOrientation()
        XCTAssertTrue(app.staticTexts["notification-stack-count"].waitForExistence(timeout: 30))
        return app
    }

    @MainActor private func openHistory(_ app: XCUIApplication) {
        // Full-screen controllers can have different safe top insets from Home.
        // Start inside the currently reachable app edge, outside the system gesture region.
        let edges = app.buttons.matching(NSPredicate(format: "label == %@", "Notification Center"))
        let reachable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            edges.allElementsBoundByIndex.contains(where: \.isHittable)
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [reachable], timeout: 10), .completed)
        guard let edge = edges.allElementsBoundByIndex.first(where: \.isHittable) else { return }
        // SwiftUI propagates app-screen-climate onto the UIKit edge as well as
        // its container. Element-relative coordinates can resolve that duplicate
        // identifier again and drag from the controller instead of the strip.
        // Freeze the reachable edge's frame, then drag in window coordinates.
        let window = app.windows.firstMatch
        let frame = edge.frame
        XCTAssertGreaterThan(frame.width, 0)
        XCTAssertGreaterThan(frame.height, 0)
        XCTAssertLessThanOrEqual(frame.height, 24)
        let start = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: frame.minX - window.frame.minX + frame.width * 0.08,
            dy: frame.midY - window.frame.minY))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 300)))
        XCTAssertTrue(app.buttons["notification-history-close"].waitForExistence(timeout: 10))
    }

    @MainActor private func rows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-history-item-"))
    }

    @MainActor private func capture(_ name: String, _ app: XCUIApplication) {
        XCTAssertGreaterThan(app.windows.firstMatch.frame.width, app.windows.firstMatch.frame.height)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
