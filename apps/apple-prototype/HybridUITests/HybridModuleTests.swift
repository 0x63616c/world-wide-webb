import XCTest

final class HybridModuleTests: XCTestCase {
    @MainActor
    func testEveryNativeModuleTileAndDetailUsesProviderFixtures() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        // Functional fixture tours keep decorative effects still so XCTest can reach idle.
        let modules = ["lights", "climate", "fan", "weather", "wifi", "sonos", "walk"]
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for module in modules {
            app.launchArguments = ["-hybridFixtures", "-hybridStill", "-moduleFlag.\(module)", "native"]
            app.launch()
            let tile = app.descendants(matching: .any)["native-\(module)-tile"].firstMatch
            XCTAssertTrue(tile.waitForExistence(timeout: 30), module)
            XCTAssertGreaterThan(app.frame.width, app.frame.height)
            if module == "walk" { XCTAssertTrue(app.buttons["Start walking Zero"].exists) }
            for other in modules where other != module { XCTAssertFalse(app.buttons["module-\(other)"].exists) }
            capture("\(module)-tile")
            app.buttons["module-detail"].tap()
            let detail = app.descendants(matching: .any)["native-\(module)-detail"].firstMatch
            XCTAssertTrue(detail.waitForExistence(timeout: 10), module)
            if module == "walk" {
                XCTAssertTrue(app.staticTexts["Zero’s walks"].exists)
                XCTAssertTrue(app.staticTexts["Walk history"].exists)
            }
            capture("\(module)-detail")
            app.buttons["module-all"].tap()
            XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 10))
            let returned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                object: app.buttons["module-detail"])
            XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 10), .completed)
            capture("\(module)-web-return")
            app.terminate()
        }
    }

    @MainActor
    func testActiveWalkOpensExistingDetailAndFailedWriteReturnsToWeb() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hybridWalkActive", "-moduleFlag.walk", "native"]
        app.launch()
        XCTAssertTrue(app.buttons["Stop walking Zero"].waitForExistence(timeout: 30))
        capture("walk-active-tile")
        app.buttons["module-detail"].tap()
        XCTAssertTrue(app.buttons["End walk"].waitForExistence(timeout: 10))
        capture("walk-active-detail")
        app.buttons["End walk"].tap() // Fixture writes fail closed, exercising live error routing.
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["module-detail"].exists)
        app.terminate()
    }

    @MainActor
    func testDefaultAndUnavailableFlagsRetainWebBoard() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for arguments in [
            ["-hybridFixtures", "-hybridStill"],
            ["-hybridFixtures", "-hybridStill", "-hybridUnavailable", "-moduleFlag.lights", "native"],
            ["-hybridFixtures", "-hybridStill", "-hybridUnavailable", "-moduleFlag.walk", "native"],
            ["-hybridFixtures", "-hybridStill", "-moduleFlag.walk", "web"],
            ["-hybridFixtures", "-hybridStill", "-moduleFlag.all", "native"]
        ] {
            app.launchArguments = arguments
            app.launch()
            // Reconnecting text comes and goes with WebKit retries; the fallback
            // contract is the accessible web surface with no native controls.
            XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 30))
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
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-moduleFlag.climate", "native", "-moduleFlag.wifi", "native"]
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
