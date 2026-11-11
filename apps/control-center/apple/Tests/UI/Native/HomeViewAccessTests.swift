import XCTest

extension HomeViewLaunchTests {
    @MainActor private func launchAccess() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-hybridControlWrites",
            "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1",
        ]
        app.launch()
        app.openAppGrid()
        return app
    }
    @MainActor private func enter(_ value: String, app: XCUIApplication) {
        for digit in value { app.buttons["pin-digit-\(digit)"].tap() }
    }
    @MainActor private func waitForLauncherToSettle(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["app-settings"].isHittable)
    }
    @MainActor func testPINChangeAndBoothOpensDirectly() {
        let app = launchAccess()
        app.buttons["app-settings"].tap()
        app.staticTexts["Security"].firstMatch.tap()
        app.buttons["settings-change-pin"].tap()
        XCTAssertTrue(app.staticTexts["Enter current PIN"].waitForExistence(timeout: 10))
        enter("999999", app: app)
        XCTAssertTrue(app.staticTexts["Incorrect PIN. Try again."].waitForExistence(timeout: 10))
        enter("135790", app: app)
        XCTAssertTrue(app.staticTexts["Choose a new PIN"].waitForExistence(timeout: 10))
        enter("024680", app: app)
        XCTAssertTrue(app.staticTexts["Confirm new PIN"].waitForExistence(timeout: 10))
        enter("024681", app: app)
        XCTAssertTrue(app.staticTexts["PINs don’t match. Try again."].waitForExistence(timeout: 10))
        app.buttons["Choose a different PIN"].tap()
        XCTAssertTrue(app.staticTexts["Choose a new PIN"].waitForExistence(timeout: 10))
        enter("246802", app: app)
        XCTAssertTrue(app.staticTexts["Confirm new PIN"].waitForExistence(timeout: 10))
        enter("246802", app: app)
        XCTAssertTrue(app.staticTexts["PIN changed"].waitForExistence(timeout: 10))
        app.buttons["app-back"].tap()
        waitForLauncherToSettle(app)
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["booth-gallery"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["pin-digit-0"].exists)
        app.buttons["app-back"].tap()
        waitForLauncherToSettle(app)
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["booth-gallery"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["pin-digit-0"].exists)
    }
    @MainActor func testEveryAppHasBackAndClockReturnsToFace() {
        let app = launchAccess()
        XCTAssertFalse(app.buttons["app-cameras"].exists)
        for id in [
            "lights", "climate", "music", "weather", "calendar", "car", "wifi", "timer", "booth", "settings",
        ] {
            app.buttons["app-\(id)"].tap()
            XCTAssertTrue(app.buttons["app-back"].waitForExistence(timeout: 15), id)
            app.buttons["app-back"].tap()
            XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 10), id)
        }
        app.swipeDown()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["app-back"].exists)
    }
    @MainActor func testWeatherStaysAnchoredWhenContentFits() {
        let app = launchAccess()
        app.buttons["app-weather"].tap()
        let city = app.staticTexts["Example City"].firstMatch
        XCTAssertTrue(city.waitForExistence(timeout: 10))
        let cityY = city.frame.minY
        let backY = app.buttons["app-back"].frame.minY
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 180)))
        XCTAssertEqual(city.frame.minY, cityY, accuracy: 1)
        XCTAssertEqual(app.buttons["app-back"].frame.minY, backY, accuracy: 1)
        XCTAssertFalse(app.buttons["app-weather"].exists)
    }
}
