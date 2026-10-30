import XCTest

final class HybridModuleTests: XCTestCase {
    @MainActor
    func testEveryNativeModuleTileAndDetailUsesProviderFixtures() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let modules = ["lights", "climate", "fan", "weather", "wifi", "sonos"]
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for module in modules {
            app.launchArguments = ["-hybridFixtures", "-moduleFlag.\(module)", "native"]
            app.launch()
            let tile = app.descendants(matching: .any)["native-\(module)-tile"].firstMatch
            XCTAssertTrue(tile.waitForExistence(timeout: 30), module)
            XCTAssertGreaterThan(app.frame.width, app.frame.height)
            for other in modules where other != module { XCTAssertFalse(app.buttons["module-\(other)"].exists) }
            capture("\(module)-tile")
            app.buttons["module-detail"].tap()
            let detail = app.descendants(matching: .any)["native-\(module)-detail"].firstMatch
            XCTAssertTrue(detail.waitForExistence(timeout: 10), module)
            capture("\(module)-detail")
            app.buttons["module-all"].tap()
            XCTAssertFalse(detail.exists)
            XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.exists)
            app.terminate()
        }
    }

    @MainActor
    func testDefaultAndUnavailableFlagsRetainWebBoard() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for arguments in [
            ["-hybridFixtures"],
            ["-hybridFixtures", "-hybridUnavailable", "-moduleFlag.lights", "native"],
            ["-hybridFixtures", "-moduleFlag.all", "native"]
        ] {
            app.launchArguments = arguments
            app.launch()
            XCTAssertTrue(app.staticTexts["Reconnecting…"].waitForExistence(timeout: 30))
            XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.exists)
            XCTAssertFalse(app.buttons["module-detail"].exists)
            capture(arguments.contains("-hybridUnavailable") ? "unavailable-web-fallback" : "default-web-board")
            app.terminate()
        }
    }

    @MainActor
    func testMultipleFlagsKeepSelectionIndependent() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.climate", "native", "-moduleFlag.wifi", "native"]
        app.launch()
        XCTAssertTrue(app.buttons["module-climate"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["module-wifi"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["module-lights"].exists)
        app.buttons["module-wifi"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-wifi-tile"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["module-climate"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-climate-tile"].firstMatch.waitForExistence(timeout: 10))
        capture("mixed-flags")
        app.terminate()
    }

    @MainActor
    private func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
