import XCTest

/// Captures the App Store screens from the `--screenshots` fixture. `fastlane ios screenshots`
/// (fastlane snapshot) runs this on iPhone 18 Pro Max and iPhone Duo in light and dark, sets the
/// 9:41 status bar and collects each `snapshot(_:)`. Run directly, it only checks the journey.
final class ScreenshotTests: XCTestCase {
  @MainActor func testAppStoreScreens() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    setupSnapshot(app)
    app.launchArguments += ["--demo", "--screenshots", "-accentColor", "Graphite"]
    app.launch()
    XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
    snapshot("home", timeWaitingForIdle: 0)

    app.buttons["logDose"].tap()
    let amount = app.textFields["doseAmount"]
    XCTAssertTrue(amount.waitForExistence(timeout: 5))
    amount.tap()
    amount.typeText("7.5")
    snapshot("log-dose", timeWaitingForIdle: 0)
    app.buttons["Cancel"].tap()

    select("Progress", in: app)
    XCTAssertTrue(app.descendants(matching: .any)["currentWeightCard"].waitForExistence(timeout: 5))
    snapshot("progress", timeWaitingForIdle: 0)

    select("Journal", in: app)
    XCTAssertTrue(app.staticTexts["pageHeader-Journal"].waitForExistence(timeout: 5))
    // Daily weigh-ins would push every dose off screen; show the titration instead.
    app.buttons["Doses"].tap()
    XCTAssertTrue(
      app.staticTexts["7.5 mg · Weekly medication"].firstMatch.waitForExistence(timeout: 5))
    snapshot("journal", timeWaitingForIdle: 0)

    select("Settings", in: app)
    XCTAssertTrue(app.staticTexts["pageHeader-Settings"].waitForExistence(timeout: 5))
    snapshot("settings", timeWaitingForIdle: 0)
  }

  /// iPhone shows a tab bar; Duo exposes its vertical rail as plain buttons.
  @MainActor private func select(_ section: String, in app: XCUIApplication) {
    let tab = app.tabBars.buttons[section]
    (tab.exists ? tab : app.buttons[section].firstMatch).tap()
  }
}
