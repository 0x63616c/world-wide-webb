import XCTest

final class NotificationBannerTests: XCTestCase {
    @MainActor func testSingleSwipeRightPreservesHistory() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-updateCheckFakeBuild", "1", "-notificationSamples",
            "-notificationHold",
        ]
        app.launch()
        let banner = app.buttons["notification-banner-lights"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertGreaterThan(banner.frame.width, 300)
        XCTAssertLessThan(app.frame.maxX - banner.frame.maxX, 90)
        XCTAssertGreaterThanOrEqual(banner.frame.minY - app.frame.minY, 72)
        XCTAssertTrue(app.buttons["notification-dismiss-lights"].isHittable)
        banner.swipeLeft()
        XCTAssertTrue(banner.exists)
        swipeRight(banner)
        XCTAssertTrue(banner.waitForNonExistence(timeout: 5))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.012))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.4)))
        XCTAssertTrue(app.buttons["notification-history-close"].waitForExistence(timeout: 10))
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-history-item-"))
                .firstMatch.exists)
    }

    @MainActor func testThreeStackExpandAndDismissIndividually() {
        let app = launchCapture("stacked")
        let top = app.buttons["notification-banner-updates"]
        XCTAssertTrue(top.waitForExistence(timeout: 20))
        XCTAssertEqual(app.staticTexts["notification-stack-count"].label, "3 notifications")
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-")).count, 1)
        capture("notification-stack", app)
        app.buttons["notification-stack-expand"].tap()
        XCTAssertTrue(app.buttons["notification-stack-collapse"].waitForExistence(timeout: 5))
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-")).count, 3)
        let alarm = app.buttons["notification-banner-alarms"]
        swipeRight(alarm)
        XCTAssertTrue(alarm.waitForNonExistence(timeout: 5))
        XCTAssertTrue(top.exists)
        XCTAssertTrue(app.buttons["notification-banner-walk"].exists)
        capture("notification-expanded-after-dismiss", app)
        app.buttons["notification-stack-collapse"].tap()
        XCTAssertTrue(app.staticTexts["notification-stack-count"].exists)
    }

    @MainActor func testExpandedStackPausesTimeouts() async {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-notificationCapture", "expanded"]
        app.launch()
        let collapse = app.buttons["notification-stack-collapse"]
        XCTAssertTrue(collapse.waitForExistence(timeout: 20))
        // Ordinary fixtures have a five-second timer; expanded reading time is unbounded.
        try? await Task.sleep(for: .seconds(6))
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-")).count, 3)
        collapse.tap()
        XCTAssertTrue(app.buttons["notification-banner-updates"].exists)
        XCTAssertFalse(app.buttons["notification-dismiss-updates"].exists)
        app.buttons["notification-stack-expand"].tap()
        XCTAssertTrue(app.buttons["notification-banner-alarms"].isHittable)
    }

    @MainActor func testSingleDeepLink() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-updateCheckFakeBuild", "1", "-notificationSamples",
            "-notificationHold",
        ]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let banner = app.buttons["notification-banner-lights"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        banner.tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(banner.exists)
    }

    @MainActor private func launchCapture(_ state: String) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-notificationCapture", state, "-notificationHold"]
        app.launch()
        return app
    }

    @MainActor private func swipeRight(_ banner: XCUIElement) {
        // A system swipe starting at the midpoint has too little runway near the right edge.
        banner.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: banner.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)))
    }

    @MainActor func testBannerAbovePresentedHomeController() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-updateCheckFakeBuild", "1",
            "-notificationSamples", "-notificationHold",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForExistence(timeout: 30))
        app.openHomeModule("climate")
        XCTAssertTrue(app.staticTexts["climate-value"].waitForExistence(timeout: 20))
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "presented-controller-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
        // Inline app destinations share the root notification presenter.
        // Require one reachable banner above the app's navigation controls.
        let banners = app.buttons.matching(identifier: "notification-banner-lights")
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [
                    XCTNSPredicateExpectation(
                        predicate: NSPredicate { _, _ in
                            banners.allElementsBoundByIndex.filter(\.isHittable).count == 1
                        }, object: app)
                ], timeout: 10), .completed)
        let reachable = banners.allElementsBoundByIndex.filter(\.isHittable)
        XCTAssertEqual(reachable.count, 1)
        guard let banner = reachable.first else { return }
        capture("notification-presented-controller", app)
        banner.tap()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor func testAutoTimeoutOnNativeHome() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-updateCheckFakeBuild", "1", "-notificationSamples"]
        app.launch()
        let banner = app.buttons["notification-banner-lights"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertTrue(banner.waitForNonExistence(timeout: 20))
    }

    @MainActor func testAccessibilityText() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-updateCheckFakeBuild", "1",
            "-notificationSamples", "-notificationHold",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let banner = app.buttons["notification-banner-lights"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertTrue(banner.isHittable)
        capture("notification-accessibility-text", app)
        swipeRight(banner)
        XCTAssertTrue(banner.waitForNonExistence(timeout: 5))
    }

    @MainActor private func capture(_ name: String, _ app: XCUIApplication) {
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        let banners = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-"))
            .allElementsBoundByIndex
        for banner in banners where banner.isHittable { XCTAssertGreaterThanOrEqual(banner.frame.width, 300) }
        let screenshot = XCUIScreen.main.screenshot()
        XCTAssertEqual(screenshot.image.size.width / screenshot.image.size.height, 1366.0 / 1024.0, accuracy: 0.01)
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
