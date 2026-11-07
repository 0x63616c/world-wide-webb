import XCTest

@MainActor final class FoldingScreenshotTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  func testToday() { capture("today") }
  func testHistory() { capture("history") }
  func testLeaderboard() { capture("leaderboard") }
  func testSettings() { capture("settings") }

  private func capture(_ scenario: String) {
    let app = XCUIApplication()
    setupSnapshot(app)
    app.launchArguments += ["--folding-screenshot-scenario", scenario]
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
    XCTAssertTrue(
      app.descendants(matching: .any)["folding.screenshot.ready"].waitForExistence(timeout: 15))
    snapshot(scenario)
    app.terminate()
  }
}
