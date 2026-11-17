import UIKit
import XCTest

/// Layout checks for whichever display the simulator shows (a fresh iPhone Duo starts on its
/// outer display) and for single-screen phones. No supported simulator API folds the Duo, so
/// live-fold state retention is a manual check (docs/DUO.md).
final class DuoLayoutTests: XCTestCase {
  override func tearDown() async throws {
    await MainActor.run { XCUIDevice.shared.orientation = .portrait }
    try await super.tearDown()
  }

  /// APP-3: inspect before touching the bar, since interaction masked the bug.
  @MainActor func testPhoneTabLabelsSurviveActivationAndSelection() throws {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = launchFixture()
    assertPhoneTabs(in: app, checkpoint: "launch")

    // Hardware Home targets the primary screen; Duo's display lifecycle is a manual check.
    if XCUIScreen.screens.count == 1 {
      XCUIDevice.shared.press(.home)
      waitUntil("Home must background the app") {
        app.state == .runningBackground || app.state == .runningBackgroundSuspended
      }
    }
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    assertPhoneTabs(in: app, checkpoint: "reactivation")

    for section in ["Treatment", "Progress", "Journal", "Settings", "Home"] {
      select(section, in: app)
      let title = section == "Home" ? "Tendr" : section
      XCTAssertTrue(app.staticTexts["pageHeader-\(title)"].waitForExistence(timeout: 5))
      assertPhoneTabs(in: app, checkpoint: "selected \(section)")
    }
  }

  @MainActor func testEditorActionsSurviveCompactHeight() throws {
    continueAfterFailure = false
    // XCUIDevice rotation does not resize a Duo window; rotate the Duo by hand (docs/DUO.md).
    try XCTSkipIf(XCUIScreen.screens.count > 1, "Duo rotation is a manual check")
    XCUIDevice.shared.orientation = .portrait
    let app = launchFixture()
    app.buttons["logDose"].tap()
    let amount = app.textFields["doseAmount"]
    XCTAssertTrue(amount.waitForExistence(timeout: 5))
    amount.tap()
    amount.typeText("7.5")
    XCUIDevice.shared.orientation = .landscapeRight
    waitUntil("Editor must resize into a short window", timeout: 15) {
      let frame = app.windows.firstMatch.frame
      return frame.width > frame.height
    }
    XCTAssertEqual(amount.value as? String, "7.5")
    XCTAssertTrue(app.buttons["saveDose"].isHittable)
    XCTAssertTrue(app.buttons["Cancel"].isHittable)
    attach("landscape-editor-actions")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
  }

  @MainActor func testAccessibilitySizeKeepsSectionsReachable() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = [
      "--demo", "--screenshots", "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityXXXL",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
    attach("accessibility-home")
    for section in ["Treatment", "Progress", "Journal", "Settings"] {
      select(section, in: app)
      XCTAssertTrue(app.staticTexts["pageHeader-\(section)"].waitForExistence(timeout: 5))
      attach("accessibility-\(section.lowercased())")
    }
  }

  @MainActor private func assertPhoneTabs(in app: XCUIApplication, checkpoint: String) {
    for section in ["Home", "Treatment", "Progress", "Journal", "Settings"] {
      let identified = app.descendants(matching: .any).matching(identifier: "nav\(section)")
      waitUntil("Missing \(section) at \(checkpoint)") {
        identified.allElementsBoundByIndex.contains { $0.isHittable }
          || app.tabBars.buttons[section].isHittable
      }
      let button =
        identified.allElementsBoundByIndex.first { $0.isHittable } ?? app.tabBars.buttons[section]
      XCTAssertEqual(button.label, section)
      XCTAssertTrue(button.isHittable, "Unreachable \(section) at \(checkpoint)")
    }
    // Accessibility titles can survive a missing rendered title. Keep visual
    // evidence as well; these assertions alone cannot prove glyph visibility.
    attach("APP-3 tab labels: \(checkpoint)")
  }

  @MainActor private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--screenshots", "-accentColor", "Graphite"]
    app.launch()
    XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
    return app
  }

  @MainActor private func select(_ section: String, in app: XCUIApplication) {
    let identified = app.descendants(matching: .any).matching(identifier: "nav\(section)")
    if let button = identified.allElementsBoundByIndex.first(where: { $0.isHittable }) {
      button.tap()
    } else {
      // Duo exposes its native vertical rail as plain buttons, outside TabBar.
      let tab = app.buttons[section]
      XCTAssertTrue(tab.waitForExistence(timeout: 5), "Section must be reachable in either layout")
      tab.tap()
    }
    waitUntil("Selecting \(section) must update the active tab") {
      identified.allElementsBoundByIndex.contains { $0.isSelected }
        || app.buttons[section].isSelected
    }
  }

  @MainActor private func waitUntil(
    _ message: String, timeout: TimeInterval = 10, _ condition: () -> Bool
  ) {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    XCTAssertTrue(condition(), message)
  }

  /// Attaches every active screen; rotated app-window screenshots can crop incorrectly.
  @MainActor private func attach(_ name: String) {
    for (index, screen) in XCUIScreen.screens.enumerated() {
      let attachment = XCTAttachment(screenshot: screen.screenshot())
      attachment.name = index == 0 ? name : "\(name) (screen \(index))"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }
}
