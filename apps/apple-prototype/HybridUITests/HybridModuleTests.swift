import XCTest

final class HybridModuleTests: XCTestCase {
    @MainActor
    func testEveryNativeModuleOpensDetailUsingProviderFixtures() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        // Functional fixture tours keep decorative effects still so XCTest can reach idle.
        let modules = ["lights", "climate", "fan", "wifi", "sonos", "walk"]
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for module in modules {
            app.launchArguments = ["-hybridFixtures", "-hybridStill", "-moduleFlag.\(module)", "native"]
            app.launchModuleFromHome()
            XCTAssertFalse(app.buttons["module-detail"].exists)
            XCTAssertTrue(app.buttons["module-home"].waitForExistence(timeout: 30))
            XCTAssertGreaterThan(app.frame.width, app.frame.height)
            let detail = app.descendants(matching: .any)["native-\(module)-detail"].firstMatch
            XCTAssertTrue(detail.waitForExistence(timeout: 10), module)
            if module == "walk" {
                XCTAssertTrue(app.staticTexts["Zero’s walks"].exists)
                XCTAssertTrue(app.staticTexts["Walk history"].exists)
            }
            capture("\(module)-detail")
            if module == "wifi" {
                // Wi-Fi details use the existing full-screen QR presentation.
                let qr = app.buttons["wifi-fullscreen-qr"]
                if qr.waitForExistence(timeout: 5) { qr.tap() }
            }
            app.returnHomeFromModule()
            app.buttons["home-classic"].tap()
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
        app.launchModuleFromHome()
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
            app.launchModuleFromHome()
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
        app.launchModuleFromHome()
        XCTAssertTrue(app.descendants(matching: .any)["native-climate-detail"].firstMatch.waitForExistence(timeout: 30))
        app.returnHomeFromModule()
        app.openHomeModule("wifi")
        XCTAssertTrue(app.descendants(matching: .any)["native-wifi-detail"].firstMatch.waitForExistence(timeout: 10))
        app.returnHomeFromModule()
        app.openHomeModule("climate")
        XCTAssertTrue(app.descendants(matching: .any)["native-climate-detail"].firstMatch.waitForExistence(timeout: 10))
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
