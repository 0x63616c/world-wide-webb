import XCTest

@MainActor final class PrototypeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }
    func testEveryTileOpensAndCloses() throws {
        let app = XCUIApplication()
        app.launch()
        for tile in ["climate", "clock", "wifi", "bedroom", "livingRoom", "ceiling", "cabinet", "fan", "all"] {
            if tile == "cabinet" {
                app.swipeLeft()
                XCTAssertTrue(app.buttons["toggle-cabinet"].waitForExistence(timeout: 3))
                XCTAssertEqual(app.buttons["face-page-1"].value as? String, "Selected")
            }
            let face = app.otherElements["tile-\(tile)"].firstMatch
            XCTAssertTrue(face.waitForExistence(timeout: 5), tile)
            // Upper-center padding is inside the circular clock and clear of glyph toggles.
            face.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
            let close = app.buttons["close-controller"]
            XCTAssertTrue(close.waitForExistence(timeout: 3), tile)
            Thread.sleep(forTimeInterval: 0.6)
            close.tap()
            XCTAssertTrue(face.waitForExistence(timeout: 3), tile)
            Thread.sleep(forTimeInterval: 0.7)
        }
    }
    func testGlyphTogglesWithoutOpeningAndClimateModes() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["toggle-bedroom"].waitForExistence(timeout: 5))
        app.swipeLeft()
        let fan = app.buttons["toggle-fan"]
        XCTAssertTrue(fan.waitForExistence(timeout: 5))
        fan.tap()
        XCTAssertFalse(app.buttons["close-controller"].exists)
        XCTAssertEqual(fan.value as? String, "On")
        app.terminate()
        app.launchArguments = ["-openTile", "climate"]
        app.launch()
        XCTAssertTrue(app.buttons["mode-off"].waitForExistence(timeout: 5))
        app.buttons["mode-off"].tap()
        XCTAssertTrue(app.buttons["climate-fan"].label.contains("Off"))
        app.buttons["mode-heat_cool"].tap()
        XCTAssertTrue(app.staticTexts["Temperature range"].exists)
    }
    func testControlsPagingPreservesSharedState() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["toggle-bedroom"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["toggle-cabinet"].isHittable)
        app.buttons["face-page-1"].tap()
        let all = app.buttons["toggle-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 3))
        XCTAssertTrue(all.isHittable)
        all.tap()
        XCTAssertEqual(all.value as? String, "On")
        XCTAssertFalse(app.buttons["close-controller"].exists)
        app.swipeRight()
        let bedroom = app.buttons["toggle-bedroom"]
        XCTAssertTrue(bedroom.waitForExistence(timeout: 3))
        XCTAssertTrue(bedroom.isHittable)
        XCTAssertEqual(app.buttons["face-page-0"].value as? String, "Selected")
        for key in ["bedroom", "livingRoom", "ceiling"] {
            XCTAssertEqual(app.buttons["toggle-\(key)"].value as? String, "On")
        }
        XCTAssertFalse(app.buttons["toggle-cabinet"].isHittable)
    }
    func testSwipeDownReturnsToSource() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-openTile", "climate"]
        app.launch()
        XCTAssertTrue(app.buttons["close-controller"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.07))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)))
        XCTAssertTrue(app.otherElements["tile-climate"].waitForExistence(timeout: 4))
    }
    func testLampGlyphAndGlobalBrightness() throws {
        let app = XCUIApplication()
        app.launch()
        let bedroom = app.buttons["toggle-bedroom"]
        XCTAssertTrue(bedroom.waitForExistence(timeout: 5))
        XCTAssertEqual(bedroom.value as? String, "On")
        bedroom.tap()
        XCTAssertEqual(bedroom.value as? String, "Off")
        XCTAssertFalse(app.buttons["close-controller"].exists)
        bedroom.tap()
        let face = app.otherElements["tile-bedroom"].firstMatch
        face.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        XCTAssertTrue(app.staticTexts["Bedroom Lamps"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["All lamps"].exists)
        Thread.sleep(forTimeInterval: 0.6)
        let brightness = app.otherElements["lamp-brightness"].firstMatch
        XCTAssertTrue(brightness.exists)
        XCTAssertEqual(brightness.value as? String, "65%")
        let livingRoom = app.buttons["controller-toggle-livingRoom"]
        XCTAssertEqual(livingRoom.value as? String, "Off")
        brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
            .press(forDuration: 0.05, thenDragTo: brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
        let value = Int((brightness.value as? String ?? "").replacingOccurrences(of: "%", with: "")) ?? -1
        XCTAssertTrue((75...85).contains(value))
        // The source command sets brightness on all lamps and turns both groups on.
        XCTAssertEqual(livingRoom.value as? String, "On")
        app.buttons["controller-toggle-bedroom"].tap()
        livingRoom.tap()
        XCTAssertFalse(brightness.isEnabled)
        let previousValue = brightness.value as? String
        brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        XCTAssertEqual(brightness.value as? String, previousValue)
        XCTAssertEqual(livingRoom.value as? String, "Off")
    }
    func testLampEffectsSheetRetainsRealControls() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-openTile", "livingRoom"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Living Room Lamps"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["White temperature"].exists)
        app.buttons["color-effects"].tap()
        XCTAssertTrue(app.staticTexts["White temperature"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.sliders["White temperature"].exists)
        app.buttons["Mood"].tap()
        app.buttons["Fast"].tap()
        app.buttons["Edit"].tap()
        app.buttons["Edit Custom 2"].tap()
        XCTAssertTrue(app.textFields["Hex color"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Save & use"].exists)
        app.buttons["Cancel"].tap()
        app.buttons["Close Color & Effects"].tap()
        XCTAssertTrue(app.buttons["color-effects"].waitForExistence(timeout: 3))
    }
    func testWifiFixturesHaveNoQR() throws {
        let app = XCUIApplication()
        for (fixture, label) in [("secured", "fixture-password-123"), ("open", "No password"), ("unconfigured", "Guest network not configured")] {
            app.launchArguments = ["-openTile", "wifi", "-wifiFixture", fixture]
            app.launch()
            XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: 5))
            XCTAssertFalse(app.images.matching(NSPredicate(format: "label CONTAINS[c] 'QR'")).firstMatch.exists)
            app.terminate()
        }
    }
}
