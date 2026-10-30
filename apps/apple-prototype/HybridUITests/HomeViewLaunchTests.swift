import XCTest

@MainActor final class HomeViewLaunchTests: XCTestCase {
    func testHomeClassicAndReturn() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures"]
        app.launch()
        let home = app.descendants(matching: .any)["native-home"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["face-page-0"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["tile-climate"].firstMatch.exists)
        capture("WWW-64-HomeView")
        app.buttons["home-classic"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 15))
        let back = app.buttons["classic-home"]
        XCTAssertTrue(back.isHittable)
        XCTAssertGreaterThanOrEqual(back.frame.height, 56)
        capture("WWW-64-Classic")
        back.tap()
        XCTAssertTrue(home.waitForExistence(timeout: 15))
        app.terminate()
    }

    func testRollbackLaunchesWebWithoutHome() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybrid.webOnly", "YES"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["home-classic"].exists)
        XCTAssertFalse(app.buttons["classic-home"].exists)
        app.terminate()
    }

    func testUnavailableHomeDoesNotShowReadings() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridUnavailable"]
        app.launch()
        XCTAssertTrue(app.buttons["tile-unavailable-climate"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["Inside 0° · Unavailable"].exists)
        app.buttons["tile-unavailable-climate"].tap()
        XCTAssertTrue(app.buttons["classic-home"].waitForExistence(timeout: 15))
        app.buttons["classic-home"].tap()
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 15))
        app.terminate()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
