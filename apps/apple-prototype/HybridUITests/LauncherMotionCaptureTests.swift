import XCTest

/// Real interactive motion captures. The record marker lets simctl start only
/// after launch/orientation, without including test-runner startup in the clips.
final class LauncherMotionCaptureTests: XCTestCase {
    @MainActor func testReveal() { capture("reveal") }
    @MainActor func testDepth() { capture("depth") }
    @MainActor func testDissolve() { capture("dissolve") }
    @MainActor func testBackButtons() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        print("MOTION_CAPTURE_READY back-buttons")
        Thread.sleep(forTimeInterval: 1) // Recording lead-in, not a correctness wait.
        for id in ["weather", "photos", "settings"] {
            app.buttons["app-\(id)"].tap()
            let back = app.buttons["app-back"]
            XCTAssertTrue(back.waitForExistence(timeout: 10), id)
            Thread.sleep(forTimeInterval: 1) // Hold the screen for the review video.
            back.tap()
            XCTAssertTrue(app.buttons["app-clock"].waitForExistence(timeout: 10), id)
        }
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE back-buttons")
    }
    @MainActor func testTimer() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO",
            "-updateCheckFakeBuild", "1", "-timerDisableNotifications"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        print("MOTION_CAPTURE_READY timer")
        Thread.sleep(forTimeInterval: 1)
        app.buttons["app-timer"].tap()
        XCTAssertTrue(app.buttons["timer-start-pause"].waitForExistence(timeout: 10))
        if app.buttons["timer-reset"].isEnabled { app.buttons["timer-reset"].tap() }
        app.buttons["timer-edit"].tap()
        app.buttons["timer-preset-15"].tap()
        app.buttons["timer-edit-save"].tap()
        Thread.sleep(forTimeInterval: 1)
        app.buttons["timer-start-pause"].tap()
        Thread.sleep(forTimeInterval: 4) // Show a real countdown, at normal speed.
        app.buttons["timer-start-pause"].tap()
        XCTAssertEqual(app.staticTexts["timer-status"].label, "Paused")
        Thread.sleep(forTimeInterval: 1)
        app.buttons["app-back"].tap()
        app.buttons["app-timer"].tap()
        app.buttons["timer-start-pause"].tap()
        Thread.sleep(forTimeInterval: 3)
        app.buttons["timer-reset"].tap()
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE timer")
    }
    @MainActor private func capture(_ style: String) {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO",
            "-updateCheckFakeBuild", "1", "-launcherTransition", style]
        app.launch()
        app.alignPanelOrientation()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 15))
        print("MOTION_CAPTURE_READY \(style)")
        Thread.sleep(forTimeInterval: 2) // Capture lead-in; never used for correctness assertions.
        app.openAppGrid()
        XCTAssertTrue(app.buttons["app-clock"].waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1)
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.85)).press(forDuration: 0.1,
            thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.85)))
        XCTAssertTrue(app.buttons["app-clock"].waitForNonExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE \(style)")
    }
}
