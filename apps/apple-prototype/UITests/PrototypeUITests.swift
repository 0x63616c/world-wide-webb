import XCTest

@MainActor final class PrototypeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }
    private func launch(_ args: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-snapshot"] + args
        app.launch()
        return app
    }
    private func waitForValue(_ element: XCUIElement, _ value: String, file: StaticString = #filePath, line: UInt = #line) {
        let updated = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [updated], timeout: 10), .completed,
                       "Expected \(value); observed \(String(describing: element.value)). \(element.debugDescription)", file: file, line: line)
    }
    func testPanelOuterMarginsInLiveWindow() throws {
        for controls in [false, true] {
            let app = launch(["-face", controls ? "controls" : "home"])
            let page = controls ? 1 : 0
            XCTAssertTrue(app.buttons["face-page-\(page)"].waitForExistence(timeout: 30))
            waitForValue(app.buttons["face-page-\(page)"], "Selected")
            let window = app.windows.firstMatch.frame
            // The button's full rectangular surface reports its painted bounds;
            // round controls expose their content bounds, so use their center.
            let moduleID = controls ? "cameras" : "calendar"
            let tile = app.descendants(matching: .any).matching(identifier: "tile-\(moduleID)").firstMatch
            XCTAssertTrue(tile.waitForExistence(timeout: 10))
            let full = tile.frame
            let last = app.descendants(matching: .any).matching(identifier: "tile-\(controls ? "all" : "fan")").firstMatch.frame
            let heading = app.staticTexts[controls ? "Home · More" : "Home"].firstMatch.frame
            let left = full.minX - window.minX
            let right = window.maxX - (last.midX + full.height / 2)
            let top = heading.minY - window.minY
            let bottom = window.maxY - 80 - (last.midY + full.height / 2)
            print("LIVE_PANEL_GEOMETRY controls=\(controls) window=\(window) heading=\(heading) margins=\(left),\(top),\(right),\(bottom)")
            XCTAssertEqual(left, right, accuracy: 0.5)
            XCTAssertEqual(top, left, accuracy: 0.5)
            XCTAssertEqual(bottom, left, accuracy: 0.5)
            app.terminate()
        }
    }

    func testHomeNavigationFromBothFaces() throws {
        let app = launch()
        XCTAssertTrue(app.buttons["open-climate"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["open-climate"].tap()
        XCTAssertTrue(app.buttons["close-controller"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["close-controller"].tap()
        XCTAssertTrue(app.buttons["face-page-1"].waitForExistence(timeout: 10))
        app.buttons["face-page-1"].tap()
        XCTAssertTrue(app.buttons["Walk Zero history"].waitForExistence(timeout: 10))
        app.buttons["Walk Zero history"].tap()
        XCTAssertTrue(app.buttons["Close Walk Zero"].waitForExistence(timeout: 10))
        app.buttons["Close Walk Zero"].tap()
        XCTAssertTrue(app.buttons["Walk Zero history"].waitForExistence(timeout: 10))
    }
    func testGlyphTogglesWithoutOpeningAndClimateModes() throws {
        let app = launch()
        let fan = app.buttons["toggle-fan"]
        XCTAssertTrue(fan.waitForExistence(timeout: 30), app.debugDescription)
        fan.tap()
        XCTAssertFalse(app.buttons["close-controller"].exists)
        waitForValue(fan, "On")
        app.terminate()
        app.launchArguments = ["-snapshot", "-openTile", "climate"]
        app.launch()
        XCTAssertTrue(app.buttons["mode-off"].waitForExistence(timeout: 30))
        app.buttons["mode-off"].tap()
        XCTAssertTrue(app.buttons["climate-fan"].label.contains("Off"))
        app.buttons["mode-heat_cool"].tap()
        XCTAssertTrue(app.staticTexts["Temperature range"].waitForExistence(timeout: 10))
    }
    func testControlsPagingPreservesSharedState() throws {
        let app = launch(["-face", "controls"])
        let all = app.buttons["toggle-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 30), app.debugDescription)
        all.tap()
        waitForValue(all, "On")
        waitForValue(app.buttons["toggle-ceiling"], "On")
        app.buttons["face-page-0"].tap()
        XCTAssertTrue(app.buttons["toggle-fan"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.buttons["face-page-0"].value as? String, "Selected")
        app.buttons["face-page-1"].tap()
        waitForValue(all, "On")
    }
    func testLampGlobalBrightnessAndRoomPower() throws {
        let app = launch(["-openTile", "lamps"])
        let brightness = app.otherElements["lamp-brightness"].firstMatch
        XCTAssertTrue(brightness.waitForExistence(timeout: 30))
        XCTAssertEqual(brightness.value as? String, "65%")
        let livingRoom = app.switches["controller-toggle-livingRoom"]
        XCTAssertEqual(livingRoom.value as? String, "0")
        brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
            .press(forDuration: 0.05, thenDragTo: brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
        let value = Int((brightness.value as? String ?? "").replacingOccurrences(of: "%", with: "")) ?? -1
        XCTAssertTrue((75...85).contains(value))
        XCTAssertEqual(livingRoom.value as? String, "1")
        let bedroom = app.switches["controller-toggle-bedroom"]
        bedroom.tap()
        waitForValue(bedroom, "0")
        livingRoom.tap()
        waitForValue(livingRoom, "0")
        let disabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == false"), object: brightness)
        XCTAssertEqual(XCTWaiter.wait(for: [disabled], timeout: 10), .completed)
    }
    func testRemoteWalkCanBeStoppedFromHistory() throws {
        let app = launch(["-openTile", "dogwalk", "-walkStartedRemotely"])
        XCTAssertTrue(app.staticTexts["Started on iPhone"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["Elapsed"].exists)
        XCTAssertEqual(app.staticTexts["walk-elapsed"].label, "12:04")
        app.buttons["End walk"].tap()
        XCTAssertTrue(app.buttons["Start walk"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["walk-elapsed"].exists)
    }
    func testLampEffectsSheetRetainsRealControls() throws {
        let app = launch(["-openTile", "lamps"])
        XCTAssertTrue(app.buttons["color-effects"].waitForExistence(timeout: 30))
        app.buttons["color-effects"].tap()
        XCTAssertTrue(app.sliders["White temperature"].waitForExistence(timeout: 10))
        app.buttons["Mood"].tap()
        app.buttons["Fast"].tap()
        app.buttons["Edit"].tap()
        app.buttons["Edit Custom 2"].tap()
        XCTAssertTrue(app.textFields["Hex color"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Save & use"].exists)
        app.buttons["Cancel"].tap()
        app.buttons["Close Color & Effects"].tap()
        XCTAssertTrue(app.buttons["color-effects"].waitForExistence(timeout: 10))
    }
    func testWifiFixturesShowJoinQRCodeOnlyWhenConfigured() throws {
        let app = XCUIApplication()
        for (fixture, label) in [("secured", "fixture-password-123"), ("open", "No password"), ("unconfigured", "Guest network not configured")] {
            app.launchArguments = ["-snapshot", "-openTile", "wifi", "-wifiFixture", fixture]
            app.launch()
            XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: 30))
            let qr = app.images["Guest Wi-Fi join QR code"]
            XCTAssertEqual(qr.exists, fixture != "unconfigured")
            app.terminate()
        }
    }
}
