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

        print("MOTION_CAPTURE_READY sonos-mixer")
        Thread.sleep(forTimeInterval: 1)
        sonos.tap()
        let master = app.descendants(matching: .any)["sonos-volume-master"].firstMatch
        let desk = app.descendants(matching: .any)["sonos-volume-Desk"].firstMatch
        let tv = app.descendants(matching: .any)["sonos-volume-Living Room"].firstMatch
        XCTAssertTrue(master.waitForExistence(timeout: 10))
        XCTAssertTrue(tv.isHittable)
        XCTAssertTrue(app.staticTexts["Home"].exists)
        XCTAssertTrue(app.staticTexts["TV"].exists)
        snapshot("sonos-mixer", app: app)

        func percentage(_ room: String) -> String {
            app.staticTexts["sonos-percent-\(room)"].label
        }
        func drag(_ slider: XCUIElement, from start: CGFloat, to end: CGFloat) {
            slider.coordinate(withNormalizedOffset: CGVector(dx: start, dy: 0.5))
                .press(forDuration: 0.1,
                       thenDragTo: slider.coordinate(withNormalizedOffset: CGVector(dx: end, dy: 0.5)),
                       withVelocity: .slow, thenHoldForDuration: 0.4)
        }

        let initialTV = percentage("Living Room")
        drag(desk, from: 0.32, to: 0.59)
        XCTAssertNotEqual(percentage("Desk"), "32%")
        XCTAssertEqual(percentage("Living Room"), initialTV)

        drag(master, from: 0.28, to: 0.47)
        XCTAssertNotEqual(percentage("Living Room"), initialTV)
        XCTAssertEqual(percentage("Desk"), percentage("Living Room"))
        XCTAssertEqual(percentage("master"), percentage("Living Room"))

        app.buttons["sonos-volume-lock"].tap()
        let before = percentage("Desk")
        drag(tv, from: 0.47, to: 0.26)
        XCTAssertNotEqual(percentage("Desk"), before)
        XCTAssertEqual(percentage("Desk"), percentage("Living Room"))
        XCTAssertEqual(percentage("master"), percentage("Living Room"))
        snapshot("sonos-linked", app: app)
        print("MOTION_CAPTURE_DONE sonos-mixer")
    }

    private func snapshot(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
