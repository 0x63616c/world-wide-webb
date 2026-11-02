import XCTest

@MainActor final class HomeViewLaunchTests: XCTestCase {
    func testHomeClassicAndReturn() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridClimateOff"]
        app.launch()
        let home = app.descendants(matching: .any)["native-home"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 30))
        // The clock is the first face (WWW-68); Home is the next page.
        XCTAssertEqual(app.buttons["face-page-0"].value as? String, "Selected")
        XCTAssertTrue(app.descendants(matching: .any)["clock-face"].firstMatch.exists)
        app.selectHomeFace(1)
        XCTAssertTrue(app.descendants(matching: .any)["tile-climate"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        XCTAssertTrue(app.buttons["tile-unavailable-climate"].waitForNonExistence(timeout: 30))
        let fan = app.buttons["toggle-fan"]
        XCTAssertTrue(fan.waitForExistence(timeout: 15))
        let climate = app.descendants(matching: .any)["tile-climate"].firstMatch
        XCTAssertTrue(climate.staticTexts["Off"].exists, "HVAC fixture is Off")
        XCTAssertEqual(fan.value as? String, "On", "Independent fan stays On with HVAC Off")
        capture("WWW-73-HomeView")
        fan.tap()
        XCTAssertTrue(app.buttons["face-page-1"].isHittable, "Fan toggle stays on Home")
        let ceiling = app.buttons["toggle-ceiling"]
        XCTAssertTrue(ceiling.isHittable)
        ceiling.tap()
        XCTAssertTrue(app.buttons["face-page-1"].isHittable, "Light toggle stays on Home")
        app.buttons["home-classic"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 15))
        let back = app.buttons["classic-home"]
        XCTAssertTrue(back.isHittable)
        XCTAssertGreaterThanOrEqual(back.frame.height, 56)
        capture("WWW-64-Classic")
        back.tap()
        XCTAssertTrue(home.waitForExistence(timeout: 15), app.debugDescription)
        app.terminate()
    }

    func testInformationalFacesDoNotOpenMenusOrDiagnostics() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-moduleFlag.alarms", "native", "-moduleFlag.weather", "native"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 30))
        let clock = app.descendants(matching: .any)["clock-face"].firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        clock.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["face-page-0"].isHittable)
        XCTAssertFalse(app.buttons["module-home"].exists)
        clock.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 2)
        XCTAssertFalse(app.buttons["diagnostics-done"].exists)
        capture("WWW-87-clock-inert")
        app.selectHomeFace(1)
        for id in ["clock", "weather"] {
            let tile = app.descendants(matching: .any)["tile-\(id)"].firstMatch
            XCTAssertTrue(tile.waitForExistence(timeout: 15))
            tile.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.15)).tap()
            XCTAssertTrue(app.buttons["face-page-1"].isHittable)
            XCTAssertFalse(app.buttons["module-home"].exists)
            XCTAssertFalse(app.buttons["diagnostics-done"].exists)
        }
        capture("WWW-87-informational-cards")
    }

    func testRollbackLaunchesWebWithoutHome() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybrid.webOnly", "YES"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["home-classic"].exists)
        XCTAssertFalse(app.buttons["classic-home"].exists)
        app.terminate()
    }

    func testUnavailableHomeDoesNotShowReadings() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridUnavailable"]
        app.launch()
        // The clock is the first face (WWW-68); readings live on the Home page.
        XCTAssertTrue(app.buttons["face-page-1"].waitForExistence(timeout: 30))
        app.selectHomeFace(1)
        XCTAssertTrue(app.buttons["tile-unavailable-climate"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["Inside 0° · Unavailable"].exists)
        app.buttons["tile-unavailable-climate"].tap()
        XCTAssertTrue(app.buttons["classic-home"].waitForExistence(timeout: 15))
        app.buttons["classic-home"].tap()
        XCTAssertTrue(app.buttons["home-classic"].waitForExistence(timeout: 15))
        app.terminate()
    }

    func testEveryUnavailableGridCardShowsAReason() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridUnavailable"]
        app.launch()
        defer { app.terminate() }
        let pages = [
            ["climate", "ceiling", "tesla", "lamps", "weather", "calendar", "fan"],
            ["sound", "cameras", "photos", "sonosRooms", "dogwalk", "media", "wifi"]
        ]
        for (index, tiles) in pages.enumerated() {
            app.selectHomeFace(index + 1)
            for tile in tiles {
                let card = app.descendants(matching: .any)["tile-\(tile)"].firstMatch
                let reason = card.staticTexts["module-status-reason"]
                XCTAssertTrue(reason.waitForExistence(timeout: 30), tile)
                let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", "Loading…"), object: reason)
                XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 30), .completed, tile)
                XCTAssertFalse(reason.label.isEmpty, tile)
                XCTAssertTrue(reason.isHittable, "Reason must be visible on \(tile)")
                XCTAssertFalse(card.staticTexts["0%"].exists, tile)
                XCTAssertFalse(card.staticTexts["0 mi"].exists, tile)
                if tile == "weather" {
                    XCTAssertFalse(app.buttons["tile-unavailable-weather"].exists)
                    card.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.15)).tap()
                    XCTAssertTrue(app.buttons["face-page-1"].isHittable)
                    XCTAssertFalse(app.buttons["module-home"].exists)
                    XCTAssertFalse(app.buttons["diagnostics-done"].exists)
                }
            }
            capture("WWW-89-unavailable-grid-\(index + 1)")
        }
    }

    func testLiveFixtureGridCaptures() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures"]
        app.launch()
        defer { app.terminate() }
        for page in [1, 2] {
            app.selectHomeFace(page)
            let unavailable = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tile-unavailable-"))
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 0"), object: unavailable)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 30), .completed)
            capture("WWW-89-live-grid-\(page)")
        }
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine").screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
