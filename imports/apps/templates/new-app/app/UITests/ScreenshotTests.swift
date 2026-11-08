import XCTest

/// Captures the App Store screens listed in apps/__SLUG__/screenshots.json.
/// scripts/capture-screenshots.sh __SLUG__ sets the status bar and appearance and collects the PNGs
/// written to SCREENSHOT_DIR (passed as TEST_RUNNER_SCREENSHOT_DIR).
final class ScreenshotTests: XCTestCase {
    @MainActor func testAppStoreScreens() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screenshots"]
        app.launch()
        XCTAssertTrue(app.staticTexts["pageHeader-__NAME__"].waitForExistence(timeout: 15))
        snap("home")

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Privacy policy"].exists || app.links["Privacy policy"].exists)
        snap("settings")
    }

    @MainActor private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.2)
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
