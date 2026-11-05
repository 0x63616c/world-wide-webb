import XCTest
import UIKit

@MainActor final class PersonalNavigationTests: XCTestCase {
    func testNativeTabsSettingsAndDraftSurviveRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "Personal navigation runs on iPhone and Duo.")
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-timerDisableNotifications"]
        app.launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 15))
        app.tabBars.buttons["More"].tap()
        app.buttons["personal-app-settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["settings-Display & idle"].exists)
        app.buttons["settings-Apps"].tap()
        XCTAssertTrue(app.switches["settings-timer-sound"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Spotify"].tap()
        let link = app.textFields["spotify-link"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        if !link.isHittable { app.swipeUp() }
        link.tap()
        link.typeText("spotify:track:test")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertEqual(link.value as? String, "spotify:track:test")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertEqual(link.value as? String, "spotify:track:test")
    }
}
