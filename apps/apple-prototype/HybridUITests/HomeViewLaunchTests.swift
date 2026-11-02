import XCTest

@MainActor final class HomeViewLaunchTests: XCTestCase {
    private func launch(unavailable: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill"]
        if unavailable { app.launchArguments.append("-hybridUnavailable") }
        app.launch()
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
        let back = app.buttons["classic-home"]
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        XCTAssertGreaterThanOrEqual(back.frame.height, 44)
        back.tap()
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
            let reason = screen.staticTexts["module-status-reason"]
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
        for (id, module) in [("lights", "lights"), ("climate", "climate"), ("weather", "weather"), ("car", "tesla")] {
            app.openAppGrid()
            app.buttons["app-\(id)"].tap()
            XCTAssertTrue(app.descendants(matching: .any)["native-\(module)-detail"].firstMatch.waitForExistence(timeout: 20))
            XCTAssertFalse(app.buttons["classic-home"].exists)
            capture("native-\(id)", app)
        }
    }
    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
