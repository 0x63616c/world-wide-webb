import XCTest

@MainActor final class PanelReturnTests: XCTestCase {
    func testSettingsAndUnavailableCarCanReturnHome() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hybridUnavailable", "-previewApp", "settings"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        XCTAssertTrue(app.navigationBars["Display"].waitForExistence(timeout: 10))
        swipeHome(app)
        XCTAssertTrue(app.buttons["app-car"].waitForExistence(timeout: 5))
        app.buttons["app-car"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["app-screen-car"].firstMatch.waitForExistence(timeout: 5))
        swipeHome(app)
        XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 5))
    }
    func testDisplaySettingsTimeoutDimsAndTapWakes() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-previewApp", "settings", "-panel.idleDimming", "YES",
                               "-panel.dimBrightness", "0.3", "-panel.wakeBrightness", "1"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        XCTAssertTrue(app.sliders["Wake brightness"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.sliders["Wake brightness"].value as? String, "100%")
        XCTAssertEqual(app.sliders["Dim brightness"].value as? String, "30%")
        app.buttons["display-dim-timeout"].tap()
        app.buttons["30 seconds"].tap()
        XCTAssertTrue(app.buttons["display-dim-timeout"].label.contains("30 seconds"))
        let settings = XCTAttachment(screenshot: app.screenshot())
        settings.name = "Display brightness settings"
        settings.lifetime = .keepAlways
        add(settings)
        XCTAssertTrue(app.buttons["Wake panel"].waitForExistence(timeout: 40))
        app.buttons["Wake panel"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Wake panel"].exists)
    }
    private func swipeHome(_ app: XCUIApplication) {
        // The application frame can remain portrait while its window is landscape.
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).press(forDuration: 0.1,
            thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
    }
}
