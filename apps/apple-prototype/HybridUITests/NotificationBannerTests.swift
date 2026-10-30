import XCTest

final class NotificationBannerTests: XCTestCase {
    @MainActor func testBannerDeepLinkAndStackDismissal() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-moduleFlag.lights", "native", "-moduleFlag.climate", "native", "-notificationHold"]
        app.launch()
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 30))
        capture("notification-baseline", app)
        app.terminate()
        app.launchArguments += ["-notificationSamples"]
        app.launch()
        let lights = app.buttons["notification-banner-lights"]
        XCTAssertTrue(lights.waitForExistence(timeout: 20))
        capture("notification-banner-before", app)
        lights.tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(lights.exists)
        capture("notification-banner-after-deep-link", app)
        app.terminate()

        app.launchArguments += ["-notificationStack"]
        app.launch()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["notification-count-lights"].exists)
        capture("notification-stack", app)
        app.buttons["notification-banner-climate"].swipeUp()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForNonExistence(timeout: 5))
        app.buttons["notification-banner-lights"].swipeLeft()
        let count = app.staticTexts["notification-count-lights"].firstMatch
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "2 notifications from Lights"), object: count)], timeout: 10), .completed)
        app.buttons["notification-dismiss-lights"].tap()
        XCTAssertTrue(count.waitForNonExistence(timeout: 10))
        app.buttons["notification-dismiss-lights"].tap()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForNonExistence(timeout: 5))
        capture("notification-stack-after-dismiss", app)
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
        let banner = app.buttons["notification-banner-lights"]
        XCTAssertTrue(banner.isHittable)
        capture("notification-presented-controller", app)
        banner.tap()
        XCTAssertTrue(banner.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor func testAutoTimeoutAndCriticalRemainOnWebFallback() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-notificationSamples", "-notificationStack", "-hybrid.webOnly", "YES"]
        app.launch()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForNonExistence(timeout: 40))
        XCTAssertTrue(app.buttons["notification-banner-climate"].exists)
        app.buttons["notification-dismiss-climate"].tap()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForNonExistence(timeout: 5))
    }

    @MainActor func testReduceMotionAndAccessibilityText() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-updateCheckFakeBuild", "1", "-notificationSamples", "-notificationStack", "-notificationReduceMotion", "-notificationHold",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let banner = app.buttons["notification-banner-climate"]
        XCTAssertTrue(banner.waitForExistence(timeout: 20))
        XCTAssertTrue(banner.isHittable)
        capture("notification-accessibility-reduce-motion", app)
        app.buttons["notification-dismiss-climate"].tap()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["notification-banner-lights"].isHittable)
    }

    @MainActor private func capture(_ name: String, _ app: XCUIApplication) {
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        let screenshot = XCUIScreen.main.screenshot()
        XCTAssertEqual(screenshot.image.size.width / screenshot.image.size.height, 1366.0 / 1024.0, accuracy: 0.01)
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
