import XCTest

@MainActor final class HomeViewLaunchTests: XCTestCase {
    private func launch(unavailable: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill"]
        if unavailable { app.launchArguments.append("-hybridUnavailable") }
        app.launch()
        app.alignPanelOrientation()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 30))
        return app
    }
    func testHomeClassicAndReturn() {
        let app = launch()
        defer { app.terminate() }
        app.openAppGrid()
        XCTAssertTrue(app.buttons["app-car"].staticTexts["Tesla"].exists)
        capture("native-launcher", app)
        app.buttons["app-classic"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-home"].firstMatch.waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.exists)
        app.openAppGrid()
        XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 15))
    }
    func testClockTapAndLongPressStayOnClock() {
        let app = launch()
        defer { app.terminate() }
        let clock = app.descendants(matching: .any)["launcher-clock"].firstMatch
        clock.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(clock.exists)
        clock.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 2)
        XCTAssertTrue(clock.exists)
        XCTAssertFalse(app.buttons["diagnostics-done"].exists)
    }
    func testRollbackLaunchesWebWithoutHome() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybrid.webOnly", "YES"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.descendants(matching: .any)["native-home"].firstMatch.exists)
    }
    func testUnavailableAppsStayNativeAndReturnHome() {
        let app = launch(unavailable: true)
        defer { app.terminate() }
        for id in ["climate", "lights", "music", "weather", "walks", "cameras", "car", "wifi"] {
            app.openAppGrid()
            app.buttons["app-\(id)"].tap()
            let screen = app.descendants(matching: .any)["app-screen-\(id)"].firstMatch
            XCTAssertTrue(screen.waitForExistence(timeout: 10))
            XCTAssertFalse(app.buttons["app-settings"].exists, "The launcher must stay hidden behind an open app")
            let reason = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "server", "unavailable")).firstMatch
            XCTAssertTrue(reason.waitForExistence(timeout: 15), id)
            XCTAssertFalse(reason.label.isEmpty)
            XCTAssertFalse(app.buttons["classic-home"].exists)
            XCTAssertFalse(screen.staticTexts["0 mi"].exists)
            XCTAssertFalse(screen.staticTexts["0%"].exists)
        }
        app.openAppGrid()
    }
    func testNativeAppsOpenWithoutClassicFallback() {
        let app = launch()
        defer { app.terminate() }
        for id in ["lights", "climate", "weather", "car"] {
            app.openAppGrid()
            app.buttons["app-\(id)"].tap()
            switch id {
            case "lights": XCTAssertTrue(app.buttons["controller-toggle-bedroom"].waitForExistence(timeout: 20))
            case "climate": XCTAssertTrue(app.buttons["Raise setpoint"].waitForExistence(timeout: 20))
            case "weather": XCTAssertTrue(app.staticTexts["HOURLY FORECAST"].waitForExistence(timeout: 20))
            default: XCTAssertTrue(app.staticTexts["Odometer"].waitForExistence(timeout: 20))
            }
            XCTAssertFalse(app.buttons["classic-home"].exists)
            capture("native-\(id)", app)
            XCTAssertFalse(app.buttons["app-settings"].exists, "The launcher must stay hidden behind an open app")
        }
    }
    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
