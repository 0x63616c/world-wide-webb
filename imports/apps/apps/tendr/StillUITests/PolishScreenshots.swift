import XCTest

/// Review captures for the 1.0.1 polish: Settings info buttons and trend option, the trend picker,
/// Progress in several trend modes, notes (empty and expanded), and the Medication graph resetting
/// to now after it was scrubbed and the page reappeared. PNGs go to `TEST_RUNNER_SCREENSHOT_DIR`.
final class PolishScreenshots: XCTestCase {
    @MainActor func testCaptureReviewScreens() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "-accentColor", "Graphite"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Settings"].waitForExistence(timeout: 5))
        snap("01-settings")
        app.buttons["appleHealthInfo"].tap()
        XCTAssertTrue(app.staticTexts["infoPopover"].waitForExistence(timeout: 5))
        snap("02-settings-info-apple-health")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        XCTAssertTrue(app.staticTexts["infoPopover"].waitForNonExistence(timeout: 5))
        app.buttons["firstDoseWeightsInfo"].tap()
        XCTAssertTrue(app.staticTexts["infoPopover"].waitForExistence(timeout: 5))
        snap("03-settings-info-first-dose")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        XCTAssertTrue(app.staticTexts["infoPopover"].waitForNonExistence(timeout: 5))

        app.tabBars.buttons["Progress"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Progress"].waitForExistence(timeout: 5))
        snap("04-progress-card")
        progressChart(app, mode: nil, name: "05-progress-7-day-average")
        progressChart(app, mode: "Smoothed trend", name: "07-progress-smoothed-trend", picker: "06-trend-picker")
        progressChart(app, mode: "Raw readings", name: "08-progress-raw-readings")

        app.tabBars.buttons["Progress"].tap()
        app.buttons["Log weight"].tap()
        XCTAssertTrue(app.textFields["weightAmount"].waitForExistence(timeout: 5))
        app.buttons["Note"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["noteField"].waitForExistence(timeout: 5))
        snap("09-note-field-empty")
        app.buttons["Cancel"].tap()

        // Notes that exist show in the Journal and open expanded.
        app.tabBars.buttons["Journal"].tap()
        let note = app.staticTexts["journalNote"].firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        snap("10-journal-with-notes")
        note.tap()
        XCTAssertTrue(app.descendants(matching: .any)["noteField"].waitForExistence(timeout: 5))
        snap("11-note-expanded")
        app.buttons["Cancel"].tap()

        // Scrub the Medication graph, leave, and come back: it is live at now again.
        app.tabBars.buttons["Home"].tap()
        let homeChart = app.descendants(matching: .any).matching(identifier: "medicationChart").firstMatch
        XCTAssertTrue(homeChart.waitForExistence(timeout: 5))
        homeChart.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        let detailChart = app.descendants(matching: .any).matching(identifier: "medicationDetailChart").firstMatch
        XCTAssertTrue(detailChart.waitForExistence(timeout: 5))
        detailChart.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.5))
            .press(forDuration: 0.2, thenDragTo: detailChart.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)))
        XCTAssertTrue(app.buttons["Live"].waitForExistence(timeout: 3))
        snap("12-medication-scrubbed")
        app.tabBars.buttons["Progress"].tap()
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(detailChart.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Live"].waitForExistence(timeout: 2))
        snap("13-medication-back-at-now")
    }

    /// Optionally switches the trend mode in Settings, then shows the Progress chart.
    @MainActor private func progressChart(_ app: XCUIApplication, mode: String?, name: String, picker: String? = nil) {
        if let mode {
            app.tabBars.buttons["Settings"].tap()
            let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Weight trend'")).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 5))
            row.tap()
            XCTAssertTrue(app.buttons[mode].waitForExistence(timeout: 5))
            if let picker { snap(picker) }
            app.buttons[mode].tap()
            app.tabBars.buttons["Progress"].tap()
        }
        let caption = app.staticTexts["weightTrendCaption"]
        // Drag from the goal card, not the chart, which would select a point instead of scrolling.
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        for _ in 0..<2 where !(caption.exists && caption.isHittable && caption.frame.minY < 420) {
            from.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)), withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTAssertEqual(caption.label, mode ?? "7-day average")
        snap(name)
    }

    @MainActor private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.2)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let directory = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !directory.isEmpty else { return }
        let url = URL(fileURLWithPath: directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
