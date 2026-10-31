import XCTest

@MainActor final class HomeViewLaunchTests: XCTestCase {
    func testHomeClassicAndReturn() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridClimateOff"]
        app.launch()
        let home = app.descendants(matching: .any)["native-home"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 30))
        // The clock is the first face (WWW-68); Home is the next page.
        XCTAssertEqual(app.buttons["face-page-0"].value as? String, "Selected")
        XCTAssertTrue(app.buttons["clock-face"].exists)
        app.selectHomeFace(1)
        XCTAssertTrue(app.descendants(matching: .any)["tile-climate"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        XCTAssertTrue(app.buttons["tile-unavailable-climate"].waitForNonExistence(timeout: 30))
        let fan = app.buttons["toggle-fan"]
        XCTAssertTrue(fan.waitForExistence(timeout: 15))
        let climate = app.descendants(matching: .any)["tile-climate"].firstMatch
        XCTAssertTrue(climate.staticTexts["Off"].exists, "HVAC fixture is Off")
        XCTAssertEqual(fan.value as? String, "On", "Independent fan stays On with HVAC Off")
        capture("WWW-73-HomeView")
        fan.tap()
        XCTAssertTrue(app.buttons["face-page-1"].isHittable, "Fan toggle stays on Home")
        let ceiling = app.buttons["toggle-ceiling"]
        XCTAssertTrue(ceiling.isHittable)
        ceiling.tap()
        XCTAssertTrue(app.buttons["face-page-1"].isHittable, "Light toggle stays on Home")
        app.buttons["home-classic"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 15))
        let back = app.buttons["classic-home"]
        XCTAssertTrue(back.isHittable)
        XCTAssertGreaterThanOrEqual(back.frame.height, 56)
        capture("WWW-64-Classic")
        back.tap()
        XCTAssertTrue(home.waitForExistence(timeout: 15), app.debugDescription)
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
        // The clock is the first face (WWW-68); readings live on the Home page.
        XCTAssertTrue(app.buttons["face-page-1"].waitForExistence(timeout: 30))
        app.selectHomeFace(1)
        XCTAssertTrue(app.buttons["tile-unavailable-climate"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["Inside 0° · Unavailable"].exists)
        app.buttons["tile-unavailable-climate"].tap()
        XCTAssertTrue(app.buttons["classic-home"].waitForExistence(timeout: 15))
        app.buttons["classic-home"].tap()
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 15))
        app.terminate()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine").screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
