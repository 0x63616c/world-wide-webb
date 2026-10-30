import XCTest

@MainActor final class WifiUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func testPasswordRevealAndFullScreenDismissal() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.wifi", "native"]
        app.launch()
        let password = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@",
            "Reveal password", "fake-password-123")).firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15))
        XCTAssertTrue(password.label.contains("Reveal password"))
        password.tap()
        XCTAssertTrue(password.label.contains("fake-password-123"))
        password.tap()
        XCTAssertTrue(password.label.contains("Reveal password"))
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Tap to scan")).firstMatch.tap()
        let qr = app.buttons["wifi-fullscreen-qr"]
        XCTAssertTrue(qr.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["module-detail"].isHittable)
        qr.tap()
        XCTAssertTrue(qr.waitForNonExistence(timeout: 5))
        XCTAssertTrue(password.isHittable)
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Tap to scan")).firstMatch.tap()
        XCTAssertTrue(qr.waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(qr.waitForNonExistence(timeout: 5))
        XCTAssertTrue(password.label.contains("Reveal password"))
    }

    func testQRClosesAfterSixtySeconds() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.wifi", "native", "-hybridDetail"]
        app.launch()
        let qr = app.buttons["wifi-fullscreen-qr"]
        XCTAssertTrue(qr.waitForExistence(timeout: 15))
        XCTAssertTrue(qr.waitForNonExistence(timeout: 65))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Tap to scan")).firstMatch.isHittable)
    }

    func testUnavailableProviderKeepsWebFallback() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.wifi", "native", "-hybridUnavailable"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Tap to scan")).firstMatch.exists)
    }
}
