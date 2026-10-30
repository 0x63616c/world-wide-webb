import XCTest

final class NotificationBannerTests: XCTestCase {
    @MainActor func testBannerDeepLinkAndStackDismissal() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.lights", "native", "-moduleFlag.climate", "native", "-notificationSamples"]
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
        XCTAssertTrue(app.buttons["notification-banner-lights"].exists) // Next item in the group.
        app.buttons["notification-dismiss-lights"].tap()
        app.buttons["notification-dismiss-lights"].tap()
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForNonExistence(timeout: 5))
        capture("notification-stack-after-dismiss", app)
    }

    @MainActor func testNormalTimeoutAndCriticalRemainOnWebFallback() {
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-notificationSamples", "-notificationStack"]
        app.launch()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["notification-banner-lights"].waitForNonExistence(timeout: 40))
        XCTAssertTrue(app.buttons["notification-banner-climate"].exists)
        app.buttons["notification-dismiss-climate"].tap()
        XCTAssertTrue(app.buttons["notification-banner-climate"].waitForNonExistence(timeout: 5))
    }

    @MainActor private func capture(_ name: String, _ app: XCUIApplication) {
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
