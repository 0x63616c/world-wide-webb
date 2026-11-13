import XCTest

@MainActor final class WifiUITests: XCTestCase {
    func testPasswordRevealKeepsLayoutStable() {
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-previewApp", "wifi"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let reveal = app.buttons["wifi-password"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 10))
        let caption = app.staticTexts["scan to connect"]
        XCTAssertTrue(caption.exists)
        let beforeButton = reveal.frame
        let beforeCaption = caption.frame
        reveal.tap()
        XCTAssertEqual(reveal.label, "Hide password")
        XCTAssertEqual(reveal.frame.minY, beforeButton.minY, accuracy: 0.5)
        XCTAssertEqual(reveal.frame.width, beforeButton.width, accuracy: 0.5)
        XCTAssertEqual(caption.frame.minY, beforeCaption.minY, accuracy: 0.5)
        reveal.tap()
        XCTAssertEqual(reveal.label, "Reveal password")
        XCTAssertEqual(reveal.frame.minY, beforeButton.minY, accuracy: 0.5)
        XCTAssertFalse(app.descendants(matching: .any)["wifi-fullscreen-qr"].firstMatch.exists)
    }
}
