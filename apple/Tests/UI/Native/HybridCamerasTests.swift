import XCTest

final class HybridCamerasTests: XCTestCase {
    @MainActor func testCamerasIsAbsentEvenWithLegacyModuleFlag() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill",
            "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        XCTAssertFalse(app.buttons["app-cameras"].exists)
        XCTAssertTrue(app.buttons["app-booth"].exists)
    }
}
