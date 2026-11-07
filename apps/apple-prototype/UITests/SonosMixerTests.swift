import XCTest

@MainActor final class SonosMixerTests: XCTestCase {
    func testMasterAndLockAdjustTheCenteredMixer() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-snapshot", "-face", "home"]
        app.launch()
        defer { app.terminate() }

        let sonos = app.buttons["app-music"]
        XCTAssertTrue(sonos.waitForExistence(timeout: 15))
        XCTAssertEqual(sonos.label, "Sonos")
        snapshot("sonos-launcher", app: app)

        sonos.tap()
        let master = app.descendants(matching: .any)["sonos-volume-master"].firstMatch
        let desk = app.descendants(matching: .any)["sonos-volume-Desk"].firstMatch
        let bedroom = app.descendants(matching: .any)["sonos-volume-Bedroom"].firstMatch
        let tv = app.descendants(matching: .any)["sonos-volume-Living Room"].firstMatch
        XCTAssertTrue(master.waitForExistence(timeout: 10))
        XCTAssertTrue(tv.isHittable)
        XCTAssertTrue(app.staticTexts["Sonos"].exists)
        XCTAssertTrue(app.staticTexts["TV"].exists)
        XCTAssertEqual(app.staticTexts.matching(identifier: "Desk").count, 1)
        XCTAssertFalse(app.staticTexts["Home speakers"].exists)
        XCTAssertTrue(app.buttons["Play together"].exists)
        snapshot("sonos-mixer", app: app)

        func percentage(_ slider: XCUIElement) -> String {
            guard let value = slider.value as? String else {
                XCTFail("Missing volume for \(slider.identifier)")
                return ""
            }
            return value
        }
        func drag(_ slider: XCUIElement, from start: CGFloat, to end: CGFloat) {
            slider.coordinate(withNormalizedOffset: CGVector(dx: start, dy: 0.5))
                .press(forDuration: 0.1,
                       thenDragTo: slider.coordinate(withNormalizedOffset: CGVector(dx: end, dy: 0.5)),
                       withVelocity: .slow, thenHoldForDuration: 0.4)
        }

        let initialTV = percentage(tv)
        XCTAssertEqual(percentage(desk), "32 percent")
        drag(desk, from: 0.32, to: 0.59)
        XCTAssertNotEqual(percentage(desk), "32 percent")
        XCTAssertEqual(percentage(tv), initialTV)

        drag(master, from: 0.28, to: 0.47)
        XCTAssertEqual(percentage(tv), initialTV)
        XCTAssertEqual(percentage(desk), percentage(bedroom))
        XCTAssertEqual(percentage(master), percentage(desk))

        app.buttons["sonos-volume-lock"].tap()
        let before = percentage(desk)
        drag(bedroom, from: 0.47, to: 0.36)
        let linked = percentage(desk)
        XCTAssertNotEqual(linked, before)
        XCTAssertEqual(linked, percentage(bedroom))
        XCTAssertEqual(linked, percentage(master))
        XCTAssertEqual(percentage(tv), initialTV)

        drag(tv, from: 0.76, to: 0.64)
        XCTAssertNotEqual(percentage(tv), initialTV)
        XCTAssertEqual(percentage(desk), linked)
        XCTAssertEqual(percentage(master), linked)
    }

    func testGroupedLineInShowsPlayingAndPausedStates() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        for (state, label) in [("playing", "Playing together · 4 rooms"), ("paused", "Grouped · paused")] {
            app.launchArguments = ["-snapshot", "-face", "home", "-groupedSonos", state]
            app.launch()
            let sonos = app.buttons["app-music"]
            XCTAssertTrue(sonos.waitForExistence(timeout: 15))
            sonos.tap()
            XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: 10))
            XCTAssertFalse(app.buttons["Play together"].exists)
            snapshot("sonos-\(state)", app: app)
            app.terminate()
        }
    }

    private func snapshot(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
