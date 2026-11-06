import XCTest

/// Real interactive motion captures. The record marker lets simctl start only
/// after launch/orientation, without including test-runner startup in the clips.
@MainActor final class LauncherMotionCaptureTests: XCTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .landscapeLeft
    }
    func testPanelHomeAndClockFaces() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO",
            "-updateCheckFakeBuild", "1", "-panel.clockFace", "green", "-previewNightClock"]
        app.launch()
        defer { app.terminate() }
        app.alignPanelOrientation()
        let clock = app.buttons["launcher-clock"]
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let window = app.windows.firstMatch
        func snapshot(_ name: String) {
            let attachment = XCTAttachment(screenshot: window.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        print("MOTION_CAPTURE_READY home-controls")
        Thread.sleep(forTimeInterval: 1)
        snapshot("clock-green-night")
        for face in ["Midnight", "Paper", "Ember"] {
            window.swipeLeft()
            XCTAssertEqual(clock.value as? String, face)
            snapshot("clock-\(face.lowercased())")
        }
        window.swipeRight()
        XCTAssertEqual(clock.value as? String, "Paper")
        clock.tap()
        XCTAssertTrue(app.buttons["app-climate"].waitForExistence(timeout: 5))
        snapshot("home")
        app.buttons["app-climate"].tap()
        XCTAssertTrue(app.buttons["climate-more"].waitForExistence(timeout: 10))
        snapshot("climate")
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE home-controls")
    }
    @MainActor func testGlassOverlay() { capture("reveal") }
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
            let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
            screenshot.name = "app-navigation-\(id)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
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
    @MainActor func testPhotoBooth() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["pin-digit-0"].waitForExistence(timeout: 10))
        for digit in "135790" { app.buttons["pin-digit-\(digit)"].tap() }
        XCTAssertTrue(app.buttons["booth-gallery"].waitForExistence(timeout: 10))
        print("MOTION_CAPTURE_READY photo-booth")
        Thread.sleep(forTimeInterval: 2)
        app.buttons["booth-gallery"].tap()
        let photo = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "booth-photo-")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10))
        print("BOOTH_SCREENSHOT gallery")
        Thread.sleep(forTimeInterval: 1)
        photo.tap()
        XCTAssertTrue(app.descendants(matching: .any)["booth-photo-detail"].firstMatch.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 2)
        app.buttons["app-back"].tap()
        app.buttons["app-back"].tap()
        app.buttons["app-back"].tap()
        XCTAssertTrue(app.buttons["app-booth"].waitForExistence(timeout: 10))
        print("BOOTH_SCREENSHOT home")
        Thread.sleep(forTimeInterval: 3)
        print("MOTION_CAPTURE_DONE photo-booth")
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
        app.buttons["launcher-clock"].tap()
        XCTAssertTrue(app.buttons["app-clock"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        screenshot.name = "clock-glass-home"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        Thread.sleep(forTimeInterval: 2)
        app.buttons["home-close"].tap()
        XCTAssertTrue(app.buttons["app-clock"].waitForNonExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE \(style)")
    }
}
