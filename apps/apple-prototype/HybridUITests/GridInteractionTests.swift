import XCTest

@MainActor final class GridInteractionTests: XCTestCase {
    private func launch(writes: Bool = true, climateOff: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-notificationHold",
            "-moduleFlag.fan", "native", "-moduleFlag.lights", "native", "-moduleFlag.climate", "native"]
        if writes { app.launchArguments.append("-hybridControlWrites") }
        if climateOff { app.launchArguments.append("-hybridClimateOff") }
        app.launch()
        app.selectHomeFace(1)
        XCTAssertTrue(app.buttons["fan-mode-on"].waitForExistence(timeout: 30))
        return app
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
        expectSelected(app.buttons["fan-mode-on"])
        expectHome(app)
        app.buttons["fan-mode-auto"].tap()
        expectSelected(app.buttons["fan-mode-auto"])
        expectHome(app)
        app.buttons["fan-mode-on"].tap()
        expectSelected(app.buttons["fan-mode-on"])
        app.buttons["fan-mode-off"].tap()
        // Web Off releases the forced fan. Cooling still reports Auto.
        expectSelected(app.buttons["fan-mode-auto"])
        expectHome(app)
        capture("WWW-81-fan-auto", app)
    }

    func testOffWithHVACOffAndFailureRollsBackWithBanner() {
        var app = launch(climateOff: true)
        app.buttons["fan-mode-off"].tap()
        expectSelected(app.buttons["fan-mode-off"])
        expectHome(app)
        app.terminate()

        app = launch(writes: false)
        defer { app.terminate() }
        app.buttons["fan-mode-off"].tap()
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
        let off = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Off"), object: ceiling)
        XCTAssertEqual(XCTWaiter.wait(for: [off], timeout: 10), .completed)
        expectHome(app)
        let slider = app.sliders["grid-lamp-brightness"]
        XCTAssertTrue(slider.isHittable)
        let originalBrightness = slider.value as? String
        slider.adjust(toNormalizedSliderPosition: 0.3)
        let changedBrightness = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (slider.value as? String) != originalBrightness
        }, object: slider)
        XCTAssertEqual(XCTWaiter.wait(for: [changedBrightness], timeout: 10), .completed)
        expectHome(app)
        let climate = app.descendants(matching: .any)["tile-climate"].firstMatch
        app.buttons["grid-climate-plus"].tap()
        XCTAssertTrue(climate.staticTexts["71°"].waitForExistence(timeout: 10))
        expectHome(app)
        app.buttons["grid-climate-minus"].tap()
        XCTAssertTrue(climate.staticTexts["70°"].waitForExistence(timeout: 10))
        expectHome(app)
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
