import XCTest

@MainActor final class TeslaDashboardTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func testVehicleStatesAndPINEntry() {
        for scenario in ["parked", "charging", "unlocked", "update", "installing", "driving", "offline", "no-power"] {
            let app = XCUIApplication()
            app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hybridTeslaScenario", scenario,
                                   "-panel.idleDimming", "NO"]
            app.launch()
            XCUIDevice.shared.orientation = .portrait
            XCUIDevice.shared.orientation = .landscapeLeft
            app.alignPanelOrientation()
            app.openHomeModule("tesla")
            XCTAssertTrue(app.staticTexts["Evee"].waitForExistence(timeout: 10), scenario)
            let lock = app.buttons["tesla-door-lock"]
            XCTAssertTrue(lock.exists, scenario)
            XCTAssertEqual(lock.isEnabled, !["driving", "installing", "offline"].contains(scenario), scenario)
            XCTAssertEqual(app.descendants(matching: .any)["tesla-update"].firstMatch.exists, ["update", "installing"].contains(scenario), scenario)
            XCTAssertTrue(app.descendants(matching: .any)["tesla-odometer"].firstMatch.exists, scenario)
            capture("evee-\(scenario)", app)
            if scenario == "parked" {
                lock.tap()
                XCTAssertTrue(app.buttons["pin-digit-0"].waitForExistence(timeout: 10))
                capture("evee-pin", app)
                app.buttons["Cancel"].tap()
                XCTAssertTrue(app.staticTexts["Evee"].waitForExistence(timeout: 10))
            }
            app.terminate()
        }
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
