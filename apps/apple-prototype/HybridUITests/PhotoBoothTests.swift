import XCTest

extension HomeViewLaunchTests {
    @MainActor func testLauncherUsesRequestedAppOrderAndSettingsIsLast() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        let ids = ["calendar", "weather", "lights", "climate", "walks"]
        let first = app.buttons["app-calendar"].frame
        for (index, id) in ids.enumerated() {
            let frame = app.buttons["app-\(id)"].frame
            XCTAssertEqual(frame.minY, first.minY, accuracy: 2)
            if index > 0 { XCTAssertGreaterThan(frame.minX, app.buttons["app-\(ids[index - 1])"].frame.minX) }
        }
        XCTAssertLessThan(app.buttons["app-photos"].frame.minX, app.buttons["app-car"].frame.minX)
        XCTAssertLessThan(app.buttons["app-car"].frame.minX, app.buttons["app-wifi"].frame.minX)
        XCTAssertGreaterThan(app.buttons["app-settings"].frame.minY, app.buttons["app-wifi"].frame.minY)
        XCTAssertGreaterThan(app.buttons["app-settings"].frame.minX, app.buttons["app-classic"].frame.minX)
    }
    @MainActor func testBoothGalleryShowsBoothPhotosAndLocksAfterBackgroundOrReopening() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO", "-hybridBoothBurst"]
        app.launch()
        defer { app.terminate() }
        app.openAppGrid()
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["pin-digit-0"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["booth-gallery"].exists)
        for digit in "135790" { app.buttons["pin-digit-\(digit)"].tap() }
        XCTAssertTrue(app.buttons["booth-gallery"].waitForExistence(timeout: 10))
        if app.staticTexts["Camera unavailable"].exists { XCTAssertFalse(app.buttons["booth-shutter"].isEnabled) }
        app.buttons["booth-gallery"].tap()
        let photos = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "booth-photo-"))
        XCTAssertTrue(photos.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(photos.count, 2, "Every booth burst frame must appear; wake photos must stay out")
        photos.firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["booth-photo-detail"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["app-back"].tap()
        XCTAssertTrue(photos.firstMatch.waitForExistence(timeout: 5))
        app.buttons["app-back"].tap()
        XCTAssertTrue(app.buttons["booth-gallery"].waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["pin-digit-0"].waitForExistence(timeout: 10))
        app.buttons["app-back"].tap()
        app.buttons["app-booth"].tap()
        XCTAssertTrue(app.buttons["pin-digit-0"].waitForExistence(timeout: 10))
    }
}
