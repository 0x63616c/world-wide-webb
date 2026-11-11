import UIKit
import XCTest

/// Run unchanged on the panel and on the Duo's outer/inner displays.
@MainActor final class CanvasLayoutTests: XCTestCase {
    func testFullScreenClockAndStableLauncherAfterAppPop() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-previewDayClock",
            "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1", "-hybridBoothCamera",
        ]
        app.launch()
        defer { app.terminate() }
        let clock = app.buttons["launcher-clock"]
        XCTAssertTrue(clock.waitForExistence(timeout: 20))
        let screen = app.windows.firstMatch.frame
        let expected = screen.size
        // Measure the current window, never the device or a canonical screen size.
        let oriented = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                abs(clock.frame.width - expected.width) < 1 && abs(clock.frame.height - expected.height) < 1
            }, object: nil)
        XCTAssertEqual(
            XCTWaiter.wait(for: [oriented], timeout: 15), .completed,
            "Production canvas must fill the current window")
        print("CANVAS_DISPLAY \(screen) XCTEST_APP \(app.frame) CLOCK \(clock.frame)")
        XCTAssertEqual(clock.frame.minX, screen.minX, accuracy: 1)
        XCTAssertEqual(clock.frame.minY, screen.minY, accuracy: 1)
        XCTAssertEqual(clock.frame.maxX, screen.maxX, accuracy: 1)
        XCTAssertEqual(clock.frame.maxY, screen.maxY, accuracy: 1)
        capture("clock", app)

        let face = clock.value as? String ?? ""
        clock.swipeLeft()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", face), object: clock)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)

        clock.tap()
        let calendar = app.buttons["app-calendar"]
        XCTAssertTrue(calendar.waitForExistence(timeout: 10))
        capture("launcher", app)
        for id in [
            "calendar", "lights", "climate", "weather", "music", "timer", "wifi", "car", "settings", "booth",
        ] {
            let button = app.buttons["app-\(id)"]
            if !button.isHittable { app.swipeUp() }
            XCTAssertTrue(button.isHittable, id)
            let anchor = button.frame
            let label = button.staticTexts.firstMatch.frame
            button.tap()
            let close = app.buttons["app-back"]
            XCTAssertTrue(close.waitForExistence(timeout: 15), id)
            XCTAssertTrue(close.isHittable, id)
            capture(id, app)
            close.tap()
            XCTAssertTrue(button.waitForExistence(timeout: 10))
            // Returning restores the same content, rather than a new text layout.
            XCTAssertEqual(button.frame.minX, anchor.minX, accuracy: 1)
            XCTAssertEqual(button.frame.minY, anchor.minY, accuracy: 1)
            XCTAssertEqual(button.frame.size.width, anchor.width, accuracy: 1)
            XCTAssertEqual(button.frame.size.height, anchor.height, accuracy: 1)
            XCTAssertEqual(button.staticTexts.firstMatch.frame, label)
        }
    }

    func testPhoneLauncherAndFullBleedClimateReturn() throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "Phone resize regression")
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-previewDayClock", "-panel.idleDimming", "NO",
            "-updateCheckFakeBuild", "1",
        ]
        app.launch()
        let clock = app.buttons["launcher-clock"]
        XCTAssertTrue(clock.waitForExistence(timeout: 20))
        clock.tap()
        let profile = app.buttons["home-profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        print("LAYOUT_PROFILE \(profile.frame) WINDOW \(app.windows.firstMatch.frame)")
        let windowBeforeOpen = app.windows.firstMatch.frame
        let calendar = app.buttons["app-calendar"]
        if windowBeforeOpen.width > windowBeforeOpen.height {
            let last = app.buttons["app-car"]
            XCTAssertEqual(calendar.frame.minY, last.frame.minY, accuracy: 2, "Wide launcher should use five columns")
            XCTAssertFalse(profile.frame.intersects(last.frame), "Profile must stay outside the last launcher tile")
        }
        app.buttons["app-climate"].tap()
        let surface = app.descendants(matching: .any)["climate-temperature-surface"].firstMatch
        XCTAssertTrue(surface.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch.frame
        print("LAYOUT_CLIMATE \(surface.frame) WINDOW \(window)")
        XCTAssertEqual(surface.frame.minX, window.minX, accuracy: 1)
        XCTAssertEqual(surface.frame.maxX, window.maxX, accuracy: 1)
        XCTAssertEqual(surface.frame.maxY, window.maxY, accuracy: 1)
        app.buttons["climate-more"].tap()
        let automatic = app.buttons["climate-fan-auto"]
        let menu = app.scrollViews.firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(menu.frame.minY, window.minY, "Menu must fit below the top edge")
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
            .press(forDuration: 0.05, thenDragTo: menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
        XCTAssertLessThanOrEqual(automatic.frame.maxY, menu.frame.maxY, "Last fan choice must scroll into view")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        app.buttons["app-back"].tap()
        XCTAssertTrue(calendar.waitForExistence(timeout: 10))
        app.buttons["app-climate"].tap()
        XCTAssertTrue(app.buttons["app-back"].waitForExistence(timeout: 10))
        app.buttons["app-back"].tap()
        XCTAssertTrue(calendar.waitForExistence(timeout: 10))
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "canvas-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
