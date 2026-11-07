import XCTest

@MainActor final class SonosMixerTests: XCTestCase {
    func testMasterPreservesRoomBalanceInTheCenteredMixer() {
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
        let masterLabelGap = abs(app.staticTexts["Master"].frame.midY - master.frame.midY)
        for (label, slider) in [("Desk", desk), ("Bedroom", bedroom), ("TV", tv)] {
            let labelGap = abs(app.staticTexts[label].frame.midY - slider.frame.midY)
            XCTAssertEqual(labelGap, masterLabelGap, accuracy: 1, label)
        }
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
        XCTAssertEqual(percentage(master), "21 percent")
        XCTAssertEqual(percentage(desk), "32 percent")
        XCTAssertFalse(app.buttons["sonos-volume-lock"].exists)
        drag(master, from: 0.79, to: 0.55)
        let level = Int(percentage(master).split(separator: " ").first ?? "") ?? 0
        XCTAssertTrue((40...60).contains(level))
        XCTAssertEqual(percentage(desk), "\(Int((32.0 * Double(level) / 21).rounded())) percent")
        XCTAssertEqual(percentage(bedroom), "\(Int((18.0 * Double(level) / 21).rounded())) percent")
        XCTAssertEqual(percentage(tv), initialTV)
        snapshot("sonos-balanced", app: app)

        let adjustedDesk = percentage(desk)
        let adjustedBedroom = percentage(bedroom)
        drag(bedroom, from: 0.55, to: 0.20)
        XCTAssertNotEqual(percentage(bedroom), adjustedBedroom)
        XCTAssertEqual(percentage(desk), adjustedDesk)
        XCTAssertNotEqual(percentage(master), "\(level) percent")

        drag(tv, from: 0.76, to: 0.64)
        XCTAssertNotEqual(percentage(tv), initialTV)
        XCTAssertEqual(percentage(desk), adjustedDesk)
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
