import XCTest

@MainActor final class WifiUITests: XCTestCase {
    func testPasswordRevealAndFullScreenDismissal() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.wifi", "native"]
        app.launch()
        let password = app.buttons["wifi-password"]
        XCTAssertTrue(password.waitForExistence(timeout: 15))
        XCTAssertTrue(password.label.contains("Reveal password"))
        password.tap()
        XCTAssertTrue(password.label.contains("fake-password-123"))
        password.tap()
        XCTAssertTrue(password.label.contains("Reveal password"))
        app.buttons["wifi-open-qr"].tap()
        let qr = app.buttons["wifi-fullscreen-qr"]
        XCTAssertTrue(qr.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["module-detail"].isHittable)
        qr.tap()
        XCTAssertTrue(qr.waitForNonExistence(timeout: 5))
        XCTAssertTrue(password.isHittable)
        app.buttons["wifi-open-qr"].tap()
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
        XCTAssertTrue(app.buttons["wifi-open-qr"].isHittable)
    }

    func testUnavailableProviderKeepsWebFallback() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.wifi", "native", "-hybridUnavailable"]
        app.launch()
        XCTAssertTrue(app.otherElements["web-board"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["wifi-open-qr"].exists)
    }
}
