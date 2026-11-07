import XCTest

final class UpdateReadyBannerTests: XCTestCase {
    @MainActor func testBannerOnNativeHome() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for _ in [0] {
            app.launchArguments = ["-hybridFixtures", "-notificationHold", "-updateCheckFakeBuild", "999999", "-updateCheckIntervalSeconds", "2"]
            app.launchModuleFromHome("lights")
            let banner = app.buttons.matching(identifier: "notification-banner-updates").firstMatch
            XCTAssertTrue(banner.waitForExistence(timeout: 30))
            XCTAssertFalse(app.buttons["notification-dismiss-updates"].exists)
            XCTAssertTrue(app.staticTexts["Build 999999 is available in TestFlight."].exists)
            banner.swipeRight()
            XCTAssertTrue(banner.exists)
            XCTAssertGreaterThan(app.windows.firstMatch.frame.width, app.windows.firstMatch.frame.height)
            XCTAssertTrue(app.buttons["controller-toggle-bedroom"].waitForExistence(timeout: 15))
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = "update-ready-native"
            capture.lifetime = .keepAlways
            add(capture)
            app.terminate()
        }
    }
}
