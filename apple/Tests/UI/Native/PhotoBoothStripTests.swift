import XCTest

extension HomeViewLaunchTests {
    @MainActor func testBoothStripTimerCancellationAndSavedGallery() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hybridBoothCamera", "-panel.idleDimming", "NO"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["booth-timer"].waitForExistence(timeout: 10))
        print("MOTION_CAPTURE_READY booth-strip")
        Thread.sleep(forTimeInterval: 1) // Recording lead-in, not a correctness wait.
        app.buttons["Strip"].tap()
        app.buttons["booth-timer"].tap()
        app.buttons["5 seconds"].tap()
        XCTAssertEqual(app.buttons["booth-timer"].label, "Self-timer, 5 seconds")
        app.buttons["booth-shutter"].tap()
        XCTAssertTrue(app.staticTexts["booth-countdown"].waitForExistence(timeout: 5))
        let countdown = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        countdown.name = "strip-countdown"; countdown.lifetime = .keepAlways; add(countdown)
        app.buttons["booth-shutter"].tap()
        XCTAssertTrue(app.staticTexts["booth-shot-progress"].waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.images["booth-capture-preview"].exists)
        app.buttons["booth-timer"].tap()
        app.buttons["Off"].tap()
        app.buttons["booth-shutter"].tap()
        XCTAssertTrue(app.staticTexts["booth-shot-progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Strip saved"].waitForExistence(timeout: 25))
        let preview = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        preview.name = "four-photo-strip-preview"; preview.lifetime = .keepAlways; add(preview)
        app.buttons["booth-gallery"].tap()
        let strip = app.buttons["booth-photo-booth:bp_simulator"]
        XCTAssertTrue(strip.waitForExistence(timeout: 10), "The saved composed strip must appear in the real gallery provider")
        strip.tap()
        XCTAssertTrue(app.descendants(matching: .any)["booth-photo-detail"].firstMatch.waitForExistence(timeout: 10))
        let detail = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        detail.name = "four-photo-strip-gallery"; detail.lifetime = .keepAlways; add(detail)
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE booth-strip")
    }
}
