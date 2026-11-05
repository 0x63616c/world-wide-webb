import XCTest

@MainActor final class PanelReturnTests: XCTestCase {
    func testSettingsAndUnavailableCarCanReturnHome() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hybridUnavailable", "-previewApp", "settings",
                               "-panel.idleDimming", "NO", "-panel.returnToClockSeconds", "0"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        app.alignPanelOrientation()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["settings-Display & idle"].waitForExistence(timeout: 10))
        app.buttons["settings-Display & idle"].tap()
        XCTAssertTrue(app.navigationBars["Display & idle"].waitForExistence(timeout: 10))
        app.buttons["app-back"].tap()
        XCTAssertTrue(app.buttons["app-car"].waitForExistence(timeout: 5))
        app.buttons["app-car"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["app-screen-car"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["app-back"].tap()
        XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 5))
    }
    func testDisplaySettingsTimeoutDimsAndTapWakes() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-previewApp", "settings", "-panel.idleDimming", "YES",
                               "-panel.dimBrightness", "0.3", "-panel.wakeBrightness", "1"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        app.alignPanelOrientation()
        XCTAssertTrue(app.buttons["settings-Display & idle"].waitForExistence(timeout: 10))
        app.buttons["settings-Display & idle"].tap()
        XCTAssertTrue(app.sliders["Wake brightness"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.sliders["Wake brightness"].value as? String, "100%")
        XCTAssertEqual(app.sliders["Dim brightness"].value as? String, "30%")
        let duration = app.sliders["display-dim-timeout"]
        duration.adjust(toNormalizedSliderPosition: 0)
        XCTAssertEqual(duration.value as? String, "15 sec")
        let settings = XCTAttachment(screenshot: app.screenshot())
        settings.name = "Display brightness settings"
        settings.lifetime = .keepAlways
        add(settings)
        XCTAssertTrue(app.buttons["Wake panel"].waitForExistence(timeout: 25))
        app.buttons["Wake panel"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Wake panel"].exists)
    }
    func testWallpaperSelectionImmediatelyUpdatesAndPersists() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-previewApp", "settings",
                               "-panel.idleDimming", "NO", "-panel.returnToClockSeconds", "0"]
        app.launch()
        defer { app.terminate() }
        app.alignPanelOrientation()
        for choice in ["coast", "lake", "forest"] {
            let button = app.buttons["wallpaper-\(choice)"]
            XCTAssertTrue(button.waitForExistence(timeout: 10))
            button.tap()
            XCTAssertTrue(button.isSelected)
            XCTAssertTrue(app.descendants(matching: .any)["wallpaper-preview"].firstMatch.label.lowercased().contains(choice))
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Wallpaper gallery"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["wallpaper-forest"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["wallpaper-forest"].isSelected)
    }
}
