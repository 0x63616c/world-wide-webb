import XCTest

final class UpdateReadyBannerTests: XCTestCase {
    @MainActor func testBannerOnNativeAndWebBoards() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for native in [true, false] {
            app.launchArguments = ["-hybridFixtures", "-notificationHold", "-updateCheckFakeBuild", "999999", "-updateCheckIntervalSeconds", "2"]
            if native { app.launchArguments += ["-moduleFlag.lights", "native"] }
            app.launchModuleFromHome()
            let banner = app.buttons.matching(identifier: "notification-banner-updates").firstMatch
            XCTAssertTrue(banner.waitForExistence(timeout: 30))
            XCTAssertTrue(app.staticTexts["Build 999999 is available in TestFlight."].exists)
            banner.swipeRight()
            XCTAssertTrue(banner.exists)
            XCTAssertGreaterThan(app.windows.firstMatch.frame.width, app.windows.firstMatch.frame.height)
            if native { XCTAssertTrue(app.buttons["controller-toggle-bedroom"].waitForExistence(timeout: 15)) }
            else { XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.exists) }
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = native ? "update-ready-native" : "update-ready-web"
            capture.lifetime = .keepAlways
            add(capture)
            app.terminate()
        }
    }
}
