import XCTest

/// Real interactive motion captures. The record marker lets simctl start only
/// after launch/orientation, without including test-runner startup in the clips.
@MainActor final class LauncherMotionCaptureTests: XCTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .landscapeLeft
    }
    func testPanelHomeAndClockFaces() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO",
            "-updateCheckFakeBuild", "1", "-previewNightClock"]
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
        let faces = ["Green", "Midnight", "Paper", "Ember"]
        let initial = try XCTUnwrap(faces.firstIndex(of: clock.value as? String ?? ""))
        snapshot("clock-\(faces[initial].lowercased())")
        func waitForFace(_ face: String) {
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", face), object: clock)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
        }
        let right = window.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
        let left = window.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5))
        right.press(forDuration: 0.1,
            thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.69, dy: 0.5)),
            withVelocity: .slow, thenHoldForDuration: 0.3)
        waitForFace(faces[initial])
        for step in 1...3 {
            right.press(forDuration: 0.1, thenDragTo: left, withVelocity: .slow, thenHoldForDuration: 0.2)
            let face = faces[(initial + step) % faces.count]
            waitForFace(face)
            snapshot("clock-\(face.lowercased())")
        }
        left.press(forDuration: 0.1, thenDragTo: right, withVelocity: .slow, thenHoldForDuration: 0.2)
        waitForFace(faces[(initial + 2) % faces.count])
        clock.tap()
        XCTAssertTrue(app.buttons["app-climate"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["home-profile"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label ENDSWITH %@", ", CALUM")).firstMatch.exists)
        snapshot("home")
        app.buttons["app-climate"].tap()
        let more = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More")).firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        snapshot("climate")
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.70))
            .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.32)))
        more.tap()
        XCTAssertTrue(app.buttons["mode-heat"].waitForExistence(timeout: 5))
        snapshot("climate-more")
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE home-controls")
    }
    func testLauncherGlassOptions() {
        continueAfterFailure = false
        let app = XCUIApplication()
        for option in ["regular", "clear", "clearDim"] {
            app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO",
                "-updateCheckFakeBuild", "1", "-previewNightClock", "-panel.clockFace", "green",
                "-previewLauncherGlass", option]
            app.launch()
            app.openAppGrid()
            let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
            shot.name = "glass-\(option)"
            shot.lifetime = .keepAlways
            add(shot)
            app.terminate()
        }
    }

    @MainActor func testGlassOverlay() { capture("swipePop") }
    @MainActor func testSwipePop() { capture("swipePop") }
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
