import XCTest

@MainActor final class PrototypeUITests: XCTestCase {
    func testEveryTileOpensAndCloses() throws {
        let app = XCUIApplication()
        app.launch()
        for tile in ["climate", "clock", "all", "fan", "lamps", "lights", "wifi", "weather", "hourly", "sound"] {
            let face = app.otherElements["tile-\(tile)"].firstMatch
            XCTAssertTrue(face.waitForExistence(timeout: 5), tile)
            // Top-left padding belongs to the tile surface, away from embedded controls.
            face.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.08)).tap()
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
