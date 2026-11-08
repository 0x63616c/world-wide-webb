import XCTest

/// Captures the App Store screens from the `--screenshots` fixture. `scripts/capture-screenshots.sh`
/// sets the simulator status bar and appearance, then collects the PNGs written to
/// `SCREENSHOT_DIR` (passed as `TEST_RUNNER_SCREENSHOT_DIR`). Without it, images are only attached.
final class ScreenshotTests: XCTestCase {
    @MainActor func testAppStoreScreens() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "-accentColor", "Graphite"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
        snap("home")

        app.buttons["logDose"].tap()
        let amount = app.textFields["doseAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        amount.tap()
        amount.typeText("7.5")
        snap("log-dose")
        app.buttons["Cancel"].tap()

        app.buttons["Progress"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["currentWeightCard"].waitForExistence(timeout: 5))
        snap("progress")

        app.buttons["Journal"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Journal"].waitForExistence(timeout: 5))
        // Daily weigh-ins would push every dose off screen; show the titration instead.
        app.buttons["Doses"].tap()
        XCTAssertTrue(app.staticTexts["7.5 mg · Weekly medication"].firstMatch.waitForExistence(timeout: 5))
        snap("journal")

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Settings"].waitForExistence(timeout: 5))
        snap("settings")
    }

    @MainActor private func snap(_ name: String) {
        // Let sheet, navigation and chart animations settle.
        Thread.sleep(forTimeInterval: 1.5)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let directory = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !directory.isEmpty else { return }
        let url = URL(fileURLWithPath: directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        XCTAssertNoThrow(try shot.pngRepresentation.write(to: url.appendingPathComponent("\(name).png")))
    }
}
