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
            let banner = app.buttons["notification-banner-updates"]
            XCTAssertTrue(banner.waitForExistence(timeout: 30))
            XCTAssertTrue(app.staticTexts["Build 999999 is available in TestFlight."].exists)
            XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
            XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
            if native { XCTAssertTrue(app.descendants(matching: .any)["native-lights-tile"].firstMatch.waitForExistence(timeout: 15)) }
            else { XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.exists) }
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = native ? "update-ready-native" : "update-ready-web"
            capture.lifetime = .keepAlways
            add(capture)
            app.terminate()
        }
    }
}
