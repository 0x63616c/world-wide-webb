import XCTest

/// Pager order mirrored from HomeFacePage (the UI test target does not link app sources).
private enum HomeFacePageIndex { static let clock = 0, home = 1, controls = 2, music = 3 }

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
    func testGridHomeIsCenteredOnBothPages() throws {
        // WWW-54: Home is a centered 6×4 grid of 192 pt cells with 24 pt gutters on both pages.
        for controls in [false, true] {
            let app = launch(["-face", controls ? "controls" : "home"])
            let page = app.buttons["face-page-\(controls ? HomeFacePageIndex.controls : HomeFacePageIndex.home)"]
            XCTAssertTrue(page.waitForExistence(timeout: 30))
            waitForValue(page, "Selected")
            let window = app.windows.firstMatch.frame
            let first = app.descendants(matching: .any)["tile-\(controls ? "sound" : "clock")"].firstMatch
            XCTAssertTrue(first.waitForExistence(timeout: 10), app.debugDescription)
            let last = app.descendants(matching: .any)["tile-\(controls ? "media" : "calendar")"].firstMatch.frame
            let left = first.frame.minX - window.minX, right = window.maxX - last.maxX
            print("GRID_GEOMETRY controls=\(controls) window=\(window) first=\(first.frame) last=\(last)")
            XCTAssertEqual(left, right, accuracy: 0.5)
            XCTAssertEqual(last.maxX - first.frame.minX, 6 * 192 + 5 * 24, accuracy: 0.5)
            XCTAssertFalse(app.staticTexts["Home · More"].exists)
            app.terminate()
        }
    }

    func testGridPageTwoCardsOpenTheirDetails() throws {
        let app = launch(["-face", "controls"])
        for id in ["cameras", "photos", "sonosRooms", "wifi", "dogwalk", "media"] {
            let card = app.descendants(matching: .any)["tile-\(id)"].firstMatch
            XCTAssertTrue(card.waitForExistence(timeout: 30), app.debugDescription)
            card.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.1)).tap()
            let close = app.buttons[id == "dogwalk" ? "Close Walk Zero" : id == "photos" ? "Close Photos" : id == "wifi" ? "close-controller" : "Close"]
            XCTAssertTrue(close.waitForExistence(timeout: 10), app.debugDescription)
            let heading = ["cameras": "Around the grounds", "photos": "Fixture photos · Johannes Plenio",
                           "sonosRooms": "Listen together", "wifi": "fixture-password-123",
                           "dogwalk": "Walk Zero", "media": "Your library"][id]!
            XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 10), app.debugDescription)
            close.tap()
            XCTAssertTrue(close.waitForNonExistence(timeout: 10), "Detail did not close for \(id)")
            XCTAssertTrue(card.waitForExistence(timeout: 10))
        }
    }
    func testGridWalkActionStaysInline() throws {
        let app = launch(["-face", "controls"])
        let start = app.buttons["Start walking Zero"]
        XCTAssertTrue(start.waitForExistence(timeout: 30))
        start.tap()
        XCTAssertTrue(app.buttons["Stop walking Zero"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Close Walk Zero"].exists)
        app.buttons["Stop walking Zero"].tap()
        XCTAssertTrue(start.waitForExistence(timeout: 10))
    }

    func testClockIsTheFirstFace() throws {
        let app = launch()
        XCTAssertTrue(app.buttons["face-page-0"].waitForExistence(timeout: 30), app.debugDescription)
        waitForValue(app.buttons["face-page-0"], "Selected")
        XCTAssertEqual(app.buttons["face-page-0"].label, "Clock face")
        XCTAssertTrue(app.buttons["clock-face"].exists)
        app.buttons["face-page-1"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["tile-climate"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
    }
    func testHomeNavigationFromBothFaces() throws {
        let app = launch(["-face", "home"])
        let climate = app.descendants(matching: .any)["tile-climate"].firstMatch
        XCTAssertTrue(climate.waitForExistence(timeout: 30), app.debugDescription)
        climate.tap()
        XCTAssertTrue(app.buttons["close-controller"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["close-controller"].tap()
        XCTAssertTrue(app.buttons["face-page-2"].waitForExistence(timeout: 10))
        app.buttons["face-page-2"].tap()
        XCTAssertTrue(app.buttons["Walk Zero history"].waitForExistence(timeout: 10))
        app.buttons["Walk Zero history"].tap()
        XCTAssertTrue(app.buttons["Close Walk Zero"].waitForExistence(timeout: 10))
        app.buttons["Close Walk Zero"].tap()
        XCTAssertTrue(app.buttons["Walk Zero history"].waitForExistence(timeout: 10))
    }
    func testGlyphTogglesWithoutOpeningAndClimateModes() throws {
        let app = launch(["-face", "home"])
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
    func testPagingPreservesSharedState() throws {
        let app = launch(["-face", "home"])
        let ceiling = app.buttons["toggle-ceiling"]
        XCTAssertTrue(ceiling.waitForExistence(timeout: 30), app.debugDescription)
        let before = ceiling.value as? String
        ceiling.tap()
        let after = before == "On" ? "Off" : "On"
        waitForValue(ceiling, after)
        app.buttons["face-page-2"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["tile-sound"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.buttons["face-page-2"].value as? String, "Selected")
        app.buttons["face-page-1"].tap()
        waitForValue(ceiling, after)
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
