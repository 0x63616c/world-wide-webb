import XCTest

final class HybridModuleTests: XCTestCase {
    @MainActor
    func testEveryNativeModuleOpensDetailUsingProviderFixtures() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        // Functional fixture tours keep decorative effects still so XCTest can reach idle.
        let modules = ["lights", "climate", "fan", "wifi", "sonos"]
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for module in modules {
            app.launchArguments = ["-hybridFixtures", "-hybridStill"]
            app.launchModuleFromHome(module)
            XCTAssertFalse(app.buttons["module-detail"].exists)
            XCTAssertTrue(app.buttons["module-home"].waitForExistence(timeout: 30))
            XCTAssertGreaterThan(app.frame.width, app.frame.height)
            let detail = app.descendants(matching: .any)["native-\(module)-detail"].firstMatch
            XCTAssertTrue(detail.waitForExistence(timeout: 10), module)
            capture("\(module)-detail")
            if module == "wifi" {
                // Wi-Fi details use the existing full-screen QR presentation.
                let qr = app.buttons["wifi-fullscreen-qr"]
                if qr.waitForExistence(timeout: 5) { qr.tap() }
            }
            app.returnHomeFromModule()
            let returned = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"),
                object: app.buttons["module-detail"])
            XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 10), .completed)
            capture("\(module)-return")
            app.terminate()
        }
    }

    @MainActor
    func testMultipleFlagsKeepSelectionIndependent() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill"]
        app.launchModuleFromHome("climate")
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
