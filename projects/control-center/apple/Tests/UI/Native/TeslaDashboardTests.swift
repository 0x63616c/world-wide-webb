import XCTest

@MainActor final class TeslaDashboardTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func testReadOnlyVehicleStates() {
        for scenario in ["parked", "charging", "unlocked", "update", "installing", "driving", "offline", "no-power"] {
            let app = XCUIApplication()
            app.launchArguments = [
                "-hybridFixtures", "-hybridStill", "-hybridTeslaScenario", scenario,
                "-panel.idleDimming", "NO",
            ]
            app.launch()
            XCUIDevice.shared.orientation = .portrait
            XCUIDevice.shared.orientation = .landscapeLeft
            app.alignPanelOrientation()
            app.openHomeModule("tesla")
            XCTAssertTrue(app.staticTexts["Evee"].waitForExistence(timeout: 10), scenario)
            let lock = app.images["tesla-lock-status"]
            XCTAssertTrue(lock.exists, scenario)
            XCTAssertEqual(lock.value as? String, scenario == "unlocked" ? "Unlocked" : "Locked", scenario)
            XCTAssertFalse(app.buttons["tesla-lock-status"].exists, scenario)
            XCTAssertFalse(app.buttons["tesla-door-lock"].exists, scenario)
            XCTAssertFalse(app.switches["tesla-door-lock"].exists, scenario)
            XCTAssertFalse(app.buttons["pin-digit-0"].exists, scenario)
            XCTAssertEqual(
                app.descendants(matching: .any)["tesla-update"].firstMatch.exists,
                ["update", "installing"].contains(scenario), scenario)
            XCTAssertTrue(app.descendants(matching: .any)["tesla-odometer"].firstMatch.exists, scenario)
            capture("evee-\(scenario)", app)
            app.terminate()
        }
    }

    func testMileageHistory() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-hybridTeslaScenario", "parked", "-panel.idleDimming", "NO",
        ]
        app.launch()
        app.alignPanelOrientation()
        app.openHomeModule("tesla")
        XCTAssertTrue(app.descendants(matching: .any)["tesla-mileage-chart"].firstMatch.waitForExistence(timeout: 10))
        capture("tesla-mileage", app)
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
