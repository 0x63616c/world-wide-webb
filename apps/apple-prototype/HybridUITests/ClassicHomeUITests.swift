import XCTest

final class ClassicHomeUITests: XCTestCase {
    @MainActor func testClassicAndModuleFallbackReturnHome() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.lights", "native"]
        app.launch()
        let classic = app.buttons["home-classic"]
        XCTAssertTrue(classic.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["module-all"].exists)
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        capture("classic-home")
        classic.tap()
        assertWebAndReturn(app)
        XCTAssertTrue(classic.waitForExistence(timeout: 10))
        app.openHomeModule("wifi") // Web by default, even with native Lights.
        assertWebAndReturn(app)
        XCTAssertTrue(classic.waitForExistence(timeout: 10))
        app.openHomeModule("lights")
        XCTAssertTrue(app.descendants(matching: .any)["native-lights-detail"].firstMatch.waitForExistence(timeout: 30))
        app.buttons["module-home"].tap()
        XCTAssertTrue(classic.waitForExistence(timeout: 10))
        app.terminate()
    }

    @MainActor private func assertWebAndReturn(_ app: XCUIApplication) {
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 10))
        let back = app.buttons["classic-home"]
        XCTAssertTrue(back.isHittable)
        XCTAssertGreaterThanOrEqual(back.frame.height, 56)
        XCTAssertFalse(app.buttons["module-lights"].exists)
        capture("classic-web-back")
        back.tap()
    }

    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
