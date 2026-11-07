import XCTest

@MainActor final class HomeViewLaunchTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        // Extension tests also run first on fresh CI simulators. A full-screen
        // landscape app frame does not set the device/SpringBoard orientation.
        XCUIDevice.shared.orientation = .landscapeLeft
    }
    private func launch(unavailable: Bool = false) -> XCUIApplication {
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
    func testIdleClockCanWakeAndOpenApps() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "YES",
                               "-panel.dimAfterSeconds", "10"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["Wake panel"].waitForExistence(timeout: 30))
        app.openAppGrid()
        XCTAssertTrue(app.buttons["app-settings"].isHittable)
        capture("launcher-after-idle-wake", app)
    }
    func testClockTapOpensHomeAndSwipeDownReturnsToClock() {
        let app = launch()
        defer { app.terminate() }
        app.buttons["launcher-clock"].tap()
        XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["app-settings"].isHittable)
        let profile = app.buttons["home-profile"]
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            profile.exists && profile.frame.maxY < app.frame.height / 2
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed)
        Thread.sleep(forTimeInterval: 1) // Allow the visual transition to settle for the capture.
        capture("home-header", app)
        XCTAssertFalse(app.buttons["launcher-clock"].exists)
        app.swipeDown()
        XCTAssertTrue(app.buttons["launcher-clock"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["app-settings"].exists)
        app.openAppGrid()
        app.buttons["app-clock"].tap()
        XCTAssertTrue(app.buttons["launcher-clock"].waitForExistence(timeout: 5))
    }
    func testSwipingDoesNotNavigateBetweenClockAndHome() {
        let app = launch()
        defer { app.terminate() }
        let window = app.windows.firstMatch
        let right = window.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        let left = window.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5))
        let clock = app.buttons["launcher-clock"]
        let original = clock.value as? String ?? ""
        right.press(forDuration: 0.1, thenDragTo: left)
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", original), object: clock)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
        XCTAssertFalse(app.buttons["home-close"].exists)
        app.openAppGrid()
        left.press(forDuration: 0.1, thenDragTo: right)
        XCTAssertTrue(app.buttons["app-settings"].isHittable)
        XCTAssertTrue(app.buttons["app-settings"].isHittable)
        app.buttons["app-settings"].tap()
        XCTAssertTrue(app.buttons["app-back"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["home-close"].exists)
        app.buttons["app-back"].tap()
        XCTAssertTrue(app.buttons["app-settings"].waitForExistence(timeout: 5))
        app.swipeDown()
        XCTAssertTrue(app.buttons["launcher-clock"].waitForExistence(timeout: 5), app.debugDescription)
    }
    func testTeslaShowsTelemetryAndOnlyLockControl() {
        let app = launch()
        defer { app.terminate() }
        app.openHomeModule("tesla")
        XCTAssertTrue(app.staticTexts["Estimated range"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Software update"].exists)
        XCTAssertTrue(app.switches["tesla-door-lock"].exists)
        XCTAssertFalse(app.switches["Charge"].exists)
        XCTAssertFalse(app.switches["Precondition"].exists)
        capture("tesla-telemetry", app)
        app.switches["tesla-door-lock"].tap()
        XCTAssertTrue(app.buttons["pin-digit-0"].waitForExistence(timeout: 10))
        app.buttons["Cancel"].tap()
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
        for id in ["climate", "lights", "music", "weather", "walks", "car", "wifi"] {
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
            case "climate": XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More")).firstMatch.waitForExistence(timeout: 20))
            case "weather": XCTAssertTrue(app.staticTexts["Feels like"].waitForExistence(timeout: 20))
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
