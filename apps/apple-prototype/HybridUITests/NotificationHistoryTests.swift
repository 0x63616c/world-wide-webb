import XCTest

final class NotificationHistoryTests: XCTestCase {
    @MainActor func testPullDownExpandSwipeClearAndClose() {
        continueAfterFailure = false
        let app = launch()
        capture("WWW-60-before-banners", app)
        openHistory(app)
        capture("WWW-60-after-history", app)
        XCTAssertEqual(rows(app).count, 2) // One exposed notification per module.
        app.buttons["notification-history-group-lights"].tap()
        XCTAssertEqual(rows(app).count, 4)
        capture("WWW-60-expanded", app)
        app.buttons["notification-history-group-lights"].tap()
        XCTAssertEqual(rows(app).count, 2)
        app.buttons["notification-history-group-lights"].tap()
        rows(app).matching(NSPredicate(format: "label CONTAINS %@", "Reading scene")).firstMatch.swipeLeft()
        app.buttons["Clear"].firstMatch.tap()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in rows(app).count == 3 }, object: app)], timeout: 10), .completed)
        app.buttons["notification-history-clear-lights"].tap()
        XCTAssertTrue(app.buttons["notification-history-group-lights"].waitForNonExistence(timeout: 10))
        XCTAssertEqual(rows(app).count, 1)
        app.buttons["notification-history-clear-all"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["notification-history-empty"].firstMatch.waitForExistence(timeout: 10))
        capture("WWW-60-cleared", app)
        let handle = app.buttons["notification-history-handle"]
        handle.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
        XCTAssertTrue(app.buttons["notification-history-close"].waitForNonExistence(timeout: 10))
    }

    @MainActor func testPersistedHistoryDeepLinksAbovePresentedController() {
        continueAfterFailure = false
        let app = launch()
        app.terminate()
        app.launchArguments.removeAll { ["-notificationResetCache", "-notificationSamples", "-notificationStack"].contains($0) }
        app.launch()
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["notification-banner-lights"].exists)
        app.openHomeModule("climate")
        XCTAssertTrue(app.descendants(matching: .any)["native-climate-detail"].firstMatch.waitForExistence(timeout: 20))
        openHistory(app)
        XCTAssertEqual(rows(app).count, 2)
        capture("WWW-60-restored-over-controller", app)
        rows(app).matching(NSPredicate(format: "label CONTAINS %@", "Reading scene")).firstMatch.tap()
        XCTAssertTrue(app.buttons["notification-history-close"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 20))
        capture("WWW-60-deep-link", app)
    }

    @MainActor private func launch() -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-moduleFlag.lights", "native",
            "-moduleFlag.climate", "native", "-notificationSamples", "-notificationStack", "-notificationHold",
            "-notificationPersistentCache", "-notificationResetCache"]
        app.launch()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForExistence(timeout: 30))
        return app
    }

    @MainActor private func openHistory(_ app: XCUIApplication) {
        // Left of the banner stack, beginning inside the app's top edge.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.012))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.4)))
        XCTAssertTrue(app.buttons["notification-history-close"].waitForExistence(timeout: 10))
    }

    @MainActor private func rows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-history-item-"))
    }

    @MainActor private func capture(_ name: String, _ app: XCUIApplication) {
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
