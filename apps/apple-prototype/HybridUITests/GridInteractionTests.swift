import XCTest

/// Regression coverage follows controls into their full-screen apps after the launcher redesign.
@MainActor final class GridInteractionTests: XCTestCase {
    private var lastWriteCount = 0
    private func launch(writes: Bool = true) -> XCUIApplication {
        lastWriteCount = 0
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        // Controls assertions must not depend on a slow CI gesture racing the
        // idle wake overlay. PanelReturnTests separately exercises idle/wake.
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hideFixtureTrace", "-notificationHold", "-panel.idleDimming", "NO"]
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
        let bar = app.descendants(matching: .any)["lamp-brightness"].firstMatch
        XCTAssertTrue(bar.isHittable)
        bar.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: bar.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)))
        expectWrite("controls.setLampBrightness", in: app)
        let temperature = app.descendants(matching: .any)["lamp-temperature"].firstMatch
        XCTAssertTrue(temperature.isHittable)
        temperature.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: temperature.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)))
        expectWrite("controls.setWhiteKelvin", in: app)
    }
    func testClimateSetpointAndIndependentFanReachBackend() {
        let app = launch()
        defer { app.terminate() }
        app.openHomeModule("climate")
        XCTAssertTrue(app.staticTexts["climate-value"].waitForExistence(timeout: 15), app.debugDescription)
        let slider = app.windows.firstMatch
        slider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
            .press(forDuration: 0.1, thenDragTo: slider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)))
        expectWrite("climate.setTarget", in: app)
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More")).firstMatch.tap()
        XCTAssertTrue(app.buttons["mode-heat"].exists)
        XCTAssertTrue(app.buttons["mode-cool"].exists)
        XCTAssertTrue(app.buttons["mode-off"].exists)
        XCTAssertFalse(app.buttons["mode-heat_cool"].exists)
        let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        screenshot.name = "climate-mode-choices"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["climate-fan-auto"].tap()
        expectWrite("controls.toggle", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["app-screen-climate"].firstMatch.exists)
    }
    func testFailedFanCommandKeepsNativePageAndShowsBanner() {
        let app = launch(writes: false)
        defer { app.terminate() }
        app.openHomeModule("climate")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More")).firstMatch.tap()
        let fan = app.buttons["climate-fan-auto"]
        XCTAssertTrue(fan.waitForExistence(timeout: 15))
        let original = fan.isSelected
        fan.tap()
        XCTAssertTrue(app.buttons["notification-banner-fan"].waitForExistence(timeout: 15))
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More")).firstMatch.tap()
        XCTAssertEqual(fan.isSelected, original)
        XCTAssertTrue(app.descendants(matching: .any)["app-screen-climate"].firstMatch.exists)
    }
}
