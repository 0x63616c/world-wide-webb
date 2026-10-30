import XCTest

final class PanelSmokeTests: XCTestCase {
    @MainActor
    func testOfflineKioskShowsRecoveryInLandscape() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        // No service, authentication, or fixture board: exercise real load failure.
        app.launchEnvironment["PANEL_SERVER_URL"] = "http://localhost:1"
        app.launch()
        XCTAssertTrue(app.staticTexts["Reconnecting…"].waitForExistence(timeout: 40))
        XCTAssertGreaterThan(app.frame.width, app.frame.height)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "panel-sim"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
    }
}
