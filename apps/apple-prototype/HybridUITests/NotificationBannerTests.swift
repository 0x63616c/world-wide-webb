import XCTest

final class NotificationBannerTests: XCTestCase {
    @MainActor func testSingleSwipeRightPreservesHistory() {
        let app = launchCapture("single")
        let banner = app.buttons["notification-banner-updates"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertEqual(banner.frame.width, 380, accuracy: 1)
        XCTAssertEqual(app.frame.maxX - banner.frame.maxX, 20, accuracy: 1)
        XCTAssertGreaterThanOrEqual(banner.frame.minY, 72)
        XCTAssertFalse(app.buttons["notification-dismiss-updates"].exists)
        banner.swipeLeft()
        XCTAssertTrue(banner.exists)
        swipeRight(banner)
        XCTAssertTrue(banner.waitForNonExistence(timeout: 5))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.012))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.4)))
        XCTAssertTrue(app.buttons["notification-history-close"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-history-item-")).firstMatch.exists)
    }

    @MainActor func testThreeStackExpandAndDismissIndividually() {
        let app = launchCapture("stacked")
        let top = app.buttons["notification-banner-updates"]
        XCTAssertTrue(top.waitForExistence(timeout: 20))
        XCTAssertEqual(app.staticTexts["notification-stack-count"].label, "3 notifications")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-")).count, 1)
        capture("notification-stack", app)
        top.tap()
        XCTAssertTrue(app.buttons["notification-stack-collapse"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-")).count, 3)
        let alarm = app.buttons["notification-banner-alarms"]
        swipeRight(alarm)
        XCTAssertTrue(alarm.waitForNonExistence(timeout: 5))
        XCTAssertTrue(top.exists)
        XCTAssertTrue(app.buttons["notification-banner-walk"].exists)
        capture("notification-expanded-after-dismiss", app)
        app.buttons["notification-stack-collapse"].tap()
        XCTAssertTrue(app.staticTexts["notification-stack-count"].exists)
    }

    @MainActor func testSingleDeepLink() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-moduleFlag.lights", "native", "-notificationSamples", "-notificationHold"]
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
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-moduleFlag.lights", "native", "-moduleFlag.climate", "native",
            "-notificationSamples", "-notificationHold"]
        app.launch()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForExistence(timeout: 30))
        app.openHomeModule("climate")
        XCTAssertTrue(app.descendants(matching: .any)["native-climate-detail"].firstMatch.waitForExistence(timeout: 20))
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "presented-controller-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
        // UIKit retains the covered host in AX during a full-screen presentation.
        // Require one reachable banner and target that presentation, not the covered host.
        let banners = app.buttons.matching(identifier: "notification-banner-lights")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                banners.allElementsBoundByIndex.filter(\.isHittable).count == 1
            }, object: app)], timeout: 10), .completed)
        let reachable = banners.allElementsBoundByIndex.filter(\.isHittable)
        XCTAssertEqual(reachable.count, 1)
        guard let banner = reachable.first else { return }
        capture("notification-presented-controller", app)
        banner.tap()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor func testAutoTimeoutOnWebFallback() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-notificationSamples", "-hybrid.webOnly", "YES"]
        app.launch()
        let banner = app.buttons["notification-banner-lights"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertTrue(banner.waitForNonExistence(timeout: 20))
    }

    @MainActor func testReduceMotionAndAccessibilityText() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-notificationCapture", "single", "-notificationReduceMotion", "-notificationHold",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let banner = app.buttons["notification-banner-updates"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertTrue(banner.isHittable)
        capture("notification-accessibility-reduce-motion", app)
        swipeRight(banner)
        XCTAssertTrue(banner.waitForNonExistence(timeout: 5))
    }

    @MainActor private func capture(_ name: String, _ app: XCUIApplication) {
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        let banners = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-banner-")).allElementsBoundByIndex
        for banner in banners where banner.isHittable { XCTAssertGreaterThanOrEqual(banner.frame.width, 300) }
        let screenshot = XCUIScreen.main.screenshot()
        XCTAssertEqual(screenshot.image.size.width / screenshot.image.size.height, 1366.0 / 1024.0, accuracy: 0.01)
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
