import XCTest

final class HybridAlarmsTests: XCTestCase {
    @MainActor
    func testClockDeepLinkAndRing() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures"]
        app.launchModuleFromHome("alarms")
        XCTAssertTrue(app.descendants(matching: .any)["native-alarms-detail"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        capture("clock")

        app.open(try XCTUnwrap(URL(string: "controlcenter://alarms")))
        if springboard.buttons["Open"].waitForExistence(timeout: 2) { springboard.buttons["Open"].tap() }
        XCTAssertTrue(app.descendants(matching: .any)["native-alarms-detail"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Add alarm"].exists)
        XCTAssertTrue(app.staticTexts["Morning"].firstMatch.exists)
        capture("alarms-deep-link")
        app.terminate()

        app.launchArguments = ["-hybridFixtures", "-hybridAlarmRinging"]
        app.launchModuleFromHome("alarms")
        XCTAssertTrue(app.buttons["Stop"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Snooze")).firstMatch.exists)
        capture("ringing")
        app.terminate()

    }

    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
