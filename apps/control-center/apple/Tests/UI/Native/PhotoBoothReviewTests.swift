import XCTest

extension HomeViewLaunchTests {
    @MainActor func testBoothNativeScreensAndStickyGallery() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-hybridBoothCamera", "-hybridBoothLibrary",
            "-panel.idleDimming", "NO",
        ]
        app.launch()
        defer { app.terminate() }
        func screenshot(_ name: String) {
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        app.openAppGrid()
        XCTAssertFalse(app.buttons["app-photos"].exists)
        screenshot("01-launcher")
        app.buttons["app-booth"].tap()
        let gallery = app.buttons["booth-gallery"]
        XCTAssertTrue(gallery.waitForExistence(timeout: 10))
        screenshot("02-photo")
        let strip = app.buttons["Strip"]
        XCTAssertGreaterThan(strip.frame.midY, app.buttons["booth-shutter"].frame.midY)
        strip.tap()
        screenshot("04-strip")
        app.buttons["booth-timer"].tap()
        app.buttons["10 seconds"].tap()
        app.buttons["booth-shutter"].tap()
        XCTAssertTrue(app.staticTexts["booth-countdown"].waitForExistence(timeout: 5))
        screenshot("04b-countdown")
        app.buttons["booth-shutter"].tap()
        gallery.tap()
        let today = app.staticTexts["Today"]
        XCTAssertTrue(today.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Yesterday"].exists)
        screenshot("05-gallery")
        let scroll = app.scrollViews["booth-gallery-scroll"]
        let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        start.press(forDuration: 0.12, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -65)))
        screenshot("06-sticky-date")
        XCTAssertTrue(today.exists)
        let tile = app.buttons["booth-photo-booth:bp_review_1_0"]
        XCTAssertTrue(tile.isHittable)
        let tileY = tile.frame.minY
        tile.tap()
        XCTAssertTrue(app.descendants(matching: .any)["booth-photo-detail"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Photo"].exists)
        screenshot("07-viewer")
        app.buttons["booth-viewer-back"].tap()
        XCTAssertTrue(scroll.exists)
        XCTAssertEqual(tile.frame.minY, tileY, accuracy: 2)

        app.buttons["booth-gallery-back"].tap()
        app.buttons["booth-timer"].tap()
        app.buttons["Off"].tap()
        app.buttons["booth-shutter"].tap()
        XCTAssertTrue(app.staticTexts["Strip saved"].waitForExistence(timeout: 25))
        screenshot("10-saved-strip")
        app.buttons["booth-gallery"].tap()
        XCTAssertTrue(app.buttons["booth-photo-booth:bp_simulator"].waitForExistence(timeout: 10))
    }
    @MainActor func testBoothShowsUnavailableCameraAndEmptyGallery() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-hybridBoothEmpty", "-panel.idleDimming", "NO"]
        app.launch()
        defer { app.terminate() }
        func screenshot(_ name: String) {
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        app.openAppGrid()
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["booth-gallery"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Camera unavailable"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["booth-shutter"].isEnabled)
        screenshot("08-camera-unavailable")
        app.buttons["booth-gallery"].tap()
        XCTAssertTrue(app.staticTexts["No booth photos yet"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Your photos and strips will appear here."].exists)
        screenshot("09-empty-gallery")
    }

}
