import XCTest

/// PR preview screens from the synthetic `--demo --screenshots` fixture (twelve weekly doses
/// alternating L/R sides, no real health data). `scripts/capture-screenshots.sh` with
/// `SCREENSHOT_TEST_KEY=pr_screenshot_test` collects the PNGs written to `SCREENSHOT_DIR`;
/// `.github/workflows/pr-screenshots.yml` posts them on UI pull requests.
final class PRScreenshotTests: XCTestCase {
    @MainActor func testPRPreviewScreens() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "-accentColor", "Graphite"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))

        // Every tab must show its title on first launch, before any tab is touched (APP-3).
        for title in ["Home", "Treatment", "Progress", "Journal", "Settings"] {
            XCTAssertTrue(navigation(title, in: app).exists, "\(title) tab is missing")
        }
        snap("tab-bar")

        navigation("Treatment", in: app).tap()
        let history = app.buttons["doseHistoryCard"]
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        for _ in 0..<4 where !history.isHittable { app.swipeUp() }
        snap("treatment")

        navigation("Journal", in: app).tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Journal"].waitForExistence(timeout: 5))
        app.buttons["Doses"].tap()
        XCTAssertTrue(app.staticTexts["7.5 mg · Weekly medication"].firstMatch.waitForExistence(timeout: 5))
        snap("journal")

        navigation("Home", in: app).tap()
        app.buttons["logDose"].tap()
        let dose = app.textFields["doseAmount"]
        XCTAssertTrue(dose.waitForExistence(timeout: 5))
        dose.tap()
        dose.typeText("7.5")
        XCTAssertTrue(app.buttons["saveDose"].isHittable)
        snap("dose-editor")
        app.buttons["Cancel"].tap()
        app.buttons["logWeight"].tap()
        let weight = app.textFields["weightAmount"]
        XCTAssertTrue(weight.waitForExistence(timeout: 5))
        weight.tap()
        weight.typeText("185")
        XCTAssertTrue(app.buttons["saveWeight"].isHittable)
        snap("weight-editor")

    }

    @MainActor private func navigation(_ title: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "nav\(title)")
            .allElementsBoundByIndex.first { $0.isHittable } ?? app.tabBars.buttons[title]
    }

    @MainActor private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.5)
        for (index, screen) in XCUIScreen.screens.enumerated() {
            let shot = screen.screenshot()
            let suffix = index == 0 ? "" : "-screen\(index)"
            let attachment = XCTAttachment(screenshot: shot)
            attachment.name = name + suffix
            attachment.lifetime = .keepAlways
            add(attachment)
            if let directory = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !directory.isEmpty {
                let url = URL(fileURLWithPath: directory, isDirectory: true)
                try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                XCTAssertNoThrow(try shot.pngRepresentation.write(to: url.appendingPathComponent("\(name)\(suffix).png")))
            }
        }
    }
}
