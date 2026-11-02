import XCTest

@MainActor final class GridInteractionTests: XCTestCase {
    private var lastWriteCount = 0

    private func launch(writes: Bool = true, climateOff: Bool = false, fanOffSupported: Bool = false) -> XCUIApplication {
        lastWriteCount = 0
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-notificationHold",
            "-moduleFlag.fan", "native", "-moduleFlag.lights", "native", "-moduleFlag.climate", "native"]
        if writes { app.launchArguments.append("-hybridControlWrites") }
        if fanOffSupported { app.launchArguments.append("-hybridFanOffSupported") }
        if climateOff { app.launchArguments.append("-hybridClimateOff") }
        app.launch()
        // Rotate the running app so UIKit and XCTest agree on touch coordinates.
        // Setting the already-current orientation before launch can leave AX's
        // landscape frames ahead of the simulator's event transform on iOS 26.
        XCUIDevice.shared.orientation = .landscapeRight
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 30))
        let home = app.descendants(matching: .any)["native-home"].firstMatch
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            abs(home.frame.width - 1366) < 2 && abs(home.frame.height - 1024) < 2
        }, object: home)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 10), .completed)
        app.selectHomeFace(1)
        XCTAssertTrue(app.buttons["fan-mode-on"].waitForExistence(timeout: 30))
        return app
    }

    private func expectWrite(_ procedure: String, in app: XCUIApplication) {
        let trace = app.staticTexts["fixture-control-write"]
        let received = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            trace.label.hasSuffix(":" + procedure)
                && (Int(trace.label.split(separator: ":").first ?? "0") ?? 0) > self.lastWriteCount
        }, object: trace)
        XCTAssertEqual(XCTWaiter.wait(for: [received], timeout: 10), .completed,
            "Fixture transport did not receive \(procedure)")
        lastWriteCount = Int(trace.label.split(separator: ":").first ?? "0") ?? lastWriteCount
        expectHome(app)
    }

    private func expectSelected(_ segment: XCUIElement) {
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Selected"), object: segment)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 10), .completed)
    }

    private func expectHome(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons["face-page-1"].isHittable)
        XCTAssertFalse(app.buttons["module-home"].exists, "Inline controls must not open detail")
    }

    func testFanSegmentsChangeStateWithoutOpeningDetail() {
        let app = launch()
        defer { app.terminate() }
        expectSelected(app.buttons["fan-mode-on"])
        capture("WWW-81-home", app)
        app.buttons["fan-mode-on"].tap()
        expectWrite("controls.toggle", in: app)
        expectSelected(app.buttons["fan-mode-on"])
        expectHome(app)
        app.buttons["fan-mode-auto"].tap()
        expectWrite("controls.toggle", in: app)
        expectSelected(app.buttons["fan-mode-auto"])
        expectHome(app)
        app.buttons["fan-mode-on"].tap()
        expectWrite("controls.toggle", in: app)
        expectSelected(app.buttons["fan-mode-on"])
        XCTAssertFalse(app.buttons["fan-mode-off"].exists)
        app.buttons["fan-mode-auto"].tap()
        expectWrite("controls.toggle", in: app)
        expectSelected(app.buttons["fan-mode-auto"])
        expectHome(app)
        capture("WWW-81-fan-auto", app)
    }

    func testFanGlyphReachesBackendWithoutOpeningDetail() {
        let app = launch()
        defer { app.terminate() }
        app.buttons["toggle-fan"].tap()
        expectWrite("controls.toggle", in: app)
        expectSelected(app.buttons["fan-mode-auto"])
    }

    func testOffWithHVACOffAndFailureRollsBackWithBanner() {
        var app = launch(climateOff: true, fanOffSupported: true)
        app.buttons["fan-mode-off"].tap()
        expectWrite("controls.setFanMode", in: app)
        expectSelected(app.buttons["fan-mode-off"])
        expectHome(app)
        app.terminate()

        app = launch(writes: false)
        defer { app.terminate() }
        app.buttons["fan-mode-auto"].tap()
        XCTAssertTrue(app.buttons["notification-banner-fan"].waitForExistence(timeout: 15))
        expectSelected(app.buttons["fan-mode-on"])
        expectHome(app)
        capture("WWW-81-fan-rollback", app)
        app.buttons["toggle-fan"].tap()
        expectSelected(app.buttons["fan-mode-on"])
        expectHome(app)
    }

    func testLightsBrightnessAndClimateControlsStayOnHome() {
        let app = launch()
        defer { app.terminate() }
        let ceiling = app.buttons["toggle-ceiling"]
        XCTAssertTrue(ceiling.waitForExistence(timeout: 15))
        ceiling.tap()
        expectWrite("controls.toggle", in: app)
        let off = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Off"), object: ceiling)
        XCTAssertEqual(XCTWaiter.wait(for: [off], timeout: 10), .completed)
        expectHome(app)
        let slider = app.sliders["grid-lamp-brightness"]
        XCTAssertTrue(slider.isHittable)
        let originalBrightness = slider.value as? String
        slider.adjust(toNormalizedSliderPosition: 0.3)
        expectWrite("controls.setLampBrightness", in: app)
        let changedBrightness = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (slider.value as? String) != originalBrightness
        }, object: slider)
        XCTAssertEqual(XCTWaiter.wait(for: [changedBrightness], timeout: 10), .completed)
        expectHome(app)
        let climate = app.descendants(matching: .any)["tile-climate"].firstMatch
        app.buttons["grid-climate-plus"].tap()
        expectWrite("climate.setTarget", in: app)
        XCTAssertTrue(climate.staticTexts["71°"].waitForExistence(timeout: 10))
        expectHome(app)
        app.buttons["grid-climate-minus"].tap()
        expectWrite("climate.setTarget", in: app)
        XCTAssertTrue(climate.staticTexts["70°"].waitForExistence(timeout: 10))
        expectHome(app)
    }

    func testEveryInlineLightToggleReachesTheBackend() {
        let app = launch()
        defer { app.terminate() }
        for key in ["ceiling", "cabinet", "lamps"] {
            app.buttons["toggle-" + key].tap()
            expectWrite("controls.toggle", in: app)
        }
    }

    func testFanDetailFillsPresentationOnRepeatedOpenAndDismiss() {
        let app = launch()
        defer { app.terminate() }
        for index in 0..<3 {
            let tile = app.descendants(matching: .any)["tile-fan"].firstMatch
            tile.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.15)).tap()
            let detail = app.descendants(matching: .any)["native-fan-detail"].firstMatch
            XCTAssertTrue(detail.waitForExistence(timeout: 15))
            // Check the controller's layout after the transition has settled.
            let fillsWidth = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                abs(detail.frame.width - app.frame.width) < 2
                    && abs(detail.frame.midX - app.frame.midX) < 2
                    && detail.frame.height > app.frame.height * 0.8
                    && detail.frame.maxY <= app.frame.maxY + 2
            }, object: detail)
            XCTAssertEqual(XCTWaiter.wait(for: [fillsWidth], timeout: 10), .completed)
            XCTAssertTrue(app.buttons["module-home"].isHittable)
            capture("WWW-81-fan-detail-\(index)", app)
            app.buttons["module-home"].tap()
            XCTAssertTrue(app.buttons["module-home"].waitForNonExistence(timeout: 10))
            expectHome(app)
        }
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
