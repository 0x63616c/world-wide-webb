import XCTest

/// Regression coverage follows controls into their full-screen apps after the launcher redesign.
@MainActor final class GridInteractionTests: XCTestCase {
    private var lastWriteCount = 0
    private func launch(writes: Bool = true) -> XCUIApplication {
        lastWriteCount = 0
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-notificationHold", "-moduleFlag.fan", "native", "-moduleFlag.lights", "native", "-moduleFlag.climate", "native"]
        if writes { app.launchArguments.append("-hybridControlWrites") }
        app.launch()
        app.openHomeModule("lights")
        return app
    }
    private func expectWrite(_ procedure: String, in app: XCUIApplication) {
        let trace = app.staticTexts["fixture-control-write"]
        let received = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            trace.label.hasSuffix(":" + procedure) && (Int(trace.label.split(separator: ":").first ?? "0") ?? 0) > self.lastWriteCount
        }, object: trace)
        XCTAssertEqual(XCTWaiter.wait(for: [received], timeout: 10), .completed, procedure)
        lastWriteCount = Int(trace.label.split(separator: ":").first ?? "0") ?? lastWriteCount
    }
    func testLightTogglesAndBrightnessReachBackend() {
        let app = launch()
        defer { app.terminate() }
        for key in ["ceiling", "cabinet", "bedroom", "livingRoom"] {
            let control = app.buttons["controller-toggle-\(key)"]
            XCTAssertTrue(control.waitForExistence(timeout: 15))
            control.tap()
            expectWrite("controls.toggle", in: app)
            XCTAssertTrue(app.descendants(matching: .any)["app-screen-lights"].firstMatch.exists)
        }
        let lamps = app.buttons["controller-toggle-bedroom"]
        if lamps.value as? String == "Off" { lamps.tap(); expectWrite("controls.toggle", in: app) }
        let slider = app.sliders["Lamp brightness"]
        XCTAssertTrue(slider.isHittable)
        slider.adjust(toNormalizedSliderPosition: 0.3)
        expectWrite("controls.setLampBrightness", in: app)
    }
    func testClimateSetpointAndIndependentFanReachBackend() {
        let app = launch()
        defer { app.terminate() }
        app.openHomeModule("climate")
        XCTAssertTrue(app.buttons["Raise setpoint"].waitForExistence(timeout: 15))
        app.buttons["Raise setpoint"].tap()
        expectWrite("climate.setTarget", in: app)
        XCTAssertTrue(app.staticTexts["71°"].waitForExistence(timeout: 10))
        app.buttons["Lower setpoint"].tap()
        expectWrite("climate.setTarget", in: app)
        XCTAssertTrue(app.staticTexts["70°"].waitForExistence(timeout: 10))
        app.buttons["climate-fan"].tap()
        expectWrite("controls.toggle", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["app-screen-climate"].firstMatch.exists)
    }
    func testFailedFanCommandKeepsNativePageAndShowsBanner() {
        let app = launch(writes: false)
        defer { app.terminate() }
        app.openHomeModule("climate")
        let fan = app.buttons["climate-fan"]
        XCTAssertTrue(fan.waitForExistence(timeout: 15))
        let original = fan.label
        fan.tap()
        XCTAssertTrue(app.buttons["notification-banner-fan"].waitForExistence(timeout: 15))
        XCTAssertEqual(fan.label, original)
        XCTAssertTrue(app.descendants(matching: .any)["app-screen-climate"].firstMatch.exists)
    }
}
