import XCTest

extension HomeViewLaunchTests {
    @MainActor private func launchTimer() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        // Timer assertions should not race the launcher's spatial entrance animation.
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill",
            "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1", "-timerDisableNotifications",
            "-launcherTransition", "dissolve",
        ]
        app.launch()
        app.alignPanelOrientation()
        app.openAppGrid()
        app.buttons["app-timer"].tap()
        XCTAssertTrue(app.staticTexts["timer-remaining"].waitForExistence(timeout: 15))
        if app.buttons["timer-stop"].exists {
            app.buttons["timer-stop"].tap()
        } else if app.buttons["timer-reset"].isEnabled {
            app.buttons["timer-reset"].tap()
        }
        app.buttons["timer-edit"].tap()
        app.buttons["timer-preset-15"].tap()
        app.buttons["timer-edit-save"].tap()
        return app
    }
    @MainActor func testTimerPausesResumesAndSurvivesLeavingItsPage() {
        let app = launchTimer()
        defer { app.terminate() }
        let remaining = app.staticTexts["timer-remaining"]
        XCTAssertEqual(remaining.value as? String, "15 minutes")
        app.buttons["timer-start-pause"].tap()
        XCTAssertTrue(remaining.waitForExistence(timeout: 5))
        let advances = expectation(for: NSPredicate(format: "value != %@", "15 minutes"), evaluatedWith: remaining)
        wait(for: [advances], timeout: 5)
        app.buttons["timer-start-pause"].tap()
        XCTAssertEqual(app.staticTexts["timer-status"].label, "Paused")
        let paused = remaining.value as? String ?? ""
        let changesWhilePaused = expectation(for: NSPredicate(format: "value != %@", paused), evaluatedWith: remaining)
        changesWhilePaused.isInverted = true
        wait(for: [changesWhilePaused], timeout: 2)
        app.buttons["app-back"].tap()
        app.buttons["app-timer"].tap()
        XCTAssertEqual(remaining.value as? String, paused)
        app.buttons["timer-start-pause"].tap()
        XCTAssertTrue(app.buttons["timer-start-pause"].label.contains("Pause"))
        let resumes = expectation(for: NSPredicate(format: "value != %@", paused), evaluatedWith: remaining)
        wait(for: [resumes], timeout: 5)
        app.buttons["app-back"].tap()
        app.buttons["app-timer"].tap()
        XCTAssertTrue(app.buttons["timer-start-pause"].label.contains("Pause"))
        app.buttons["timer-reset"].tap()
        let reset = expectation(for: NSPredicate(format: "value == %@", "15 minutes"), evaluatedWith: remaining)
        wait(for: [reset], timeout: 5)
        XCTAssertTrue(app.buttons["timer-edit"].isEnabled)
    }
    @MainActor func testZeroTimerSelectionReturnsToOneMinute() {
        let app = launchTimer()
        defer { app.terminate() }
        app.buttons["timer-edit"].tap()
        app.pickerWheels.element(boundBy: 1).adjust(toPickerWheelValue: "0")
        let minute = app.pickerWheels.element(boundBy: 1)
        let rebounds = expectation(
            for: NSPredicate { _, _ in
                return minute.value as? String == "1"
            }, evaluatedWith: minute)
        wait(for: [rebounds], timeout: 5)
        XCTAssertTrue(app.buttons["timer-edit-save"].isEnabled)
        app.buttons["timer-edit-save"].tap()
        XCTAssertEqual(app.staticTexts["timer-remaining"].value as? String, "1 minute")
    }

    @MainActor func testCustomTimerFinishesAndCanBeStopped() {
        let app = launchTimer()
        defer { app.terminate() }
        app.buttons["timer-edit"].tap()
        app.pickerWheels.element(boundBy: 0).adjust(toPickerWheelValue: "0")
        app.pickerWheels.element(boundBy: 2).adjust(toPickerWheelValue: "5")
        app.pickerWheels.element(boundBy: 1).adjust(toPickerWheelValue: "0")
        app.buttons["timer-edit-save"].tap()
        XCTAssertEqual(app.staticTexts["timer-remaining"].value as? String, "5 seconds")
        app.buttons["timer-start-pause"].tap()
        app.buttons["app-back"].tap()
        app.buttons["app-climate"].tap()
        let banner = app.buttons["notification-banner-timer"]
        XCTAssertTrue(banner.waitForExistence(timeout: 12))
        banner.tap()
        let status = app.staticTexts["timer-status"]
        let finished = expectation(
            for: NSPredicate { _, _ in
                return status.exists && status.label == "Time’s up"
            }, evaluatedWith: status)
        wait(for: [finished], timeout: 12)
        XCTAssertEqual(app.staticTexts["timer-remaining"].value as? String, "0 seconds")
        XCTAssertTrue(app.buttons["timer-stop"].isHittable)
        app.buttons["timer-stop"].tap()
        XCTAssertEqual(app.staticTexts["timer-remaining"].value as? String, "5 seconds")
        XCTAssertTrue(app.buttons["timer-start-pause"].label.contains("Start"))
        app.buttons["timer-start-pause"].tap()
        XCTAssertTrue(app.buttons["timer-start-pause"].label.contains("Pause"))
        app.buttons["timer-reset"].tap()
    }
}
