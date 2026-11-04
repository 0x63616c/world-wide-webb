import XCTest

/// Real interactive motion captures. The record marker lets simctl start only
/// after launch/orientation, without including test-runner startup in the clips.
final class LauncherMotionCaptureTests: XCTestCase {
    @MainActor func testReveal() { capture("reveal") }
    @MainActor func testDepth() { capture("depth") }
    @MainActor func testDissolve() { capture("dissolve") }
    @MainActor private func capture(_ style: String) {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-panel.idleDimming", "NO",
            "-updateCheckFakeBuild", "1", "-launcherTransition", style]
        app.launch()
        app.alignPanelOrientation()
        XCTAssertTrue(app.descendants(matching: .any)["launcher-clock"].firstMatch.waitForExistence(timeout: 15))
        print("MOTION_CAPTURE_READY \(style)")
        Thread.sleep(forTimeInterval: 2) // Capture lead-in; never used for correctness assertions.
        app.openAppGrid()
        XCTAssertTrue(app.buttons["app-clock"].waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1)
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.85)).press(forDuration: 0.1,
            thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.85)))
        XCTAssertTrue(app.buttons["app-clock"].waitForNonExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        print("MOTION_CAPTURE_DONE \(style)")
    }
}
