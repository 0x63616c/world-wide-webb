import XCTest

final class HybridCamerasTests: XCTestCase {
    @MainActor func testSnapshotsLiveViewAndFallback() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-moduleFlag.cameras", "native"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["native-cameras-tile"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
        XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
        let first = app.buttons["Open Test Camera A"]
        waitForImage(first)
        capture("cameras-tile")
        first.tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-cameras-detail"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Open Test Camera B"].exists)
        waitForImage(app.buttons["Open Test Camera B"])
        capture("cameras-overview")
        app.buttons["Open Test Camera B"].tap()
        XCTAssertTrue(app.buttons["All cameras"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Live view · Refresh every second"].exists)
        let selected = app.buttons["Open Test Camera B"]
        waitForImage(selected)
        let before = selected.value as? String ?? ""
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value != %@ AND value BEGINSWITH %@", before, "Updated "),
            object: selected)], timeout: 8), .completed)
        capture("cameras-live")
        app.buttons["All cameras"].tap()
        XCTAssertTrue(app.buttons["Open Test Camera A"].exists)
        app.terminate()

        for arguments in [
            ["-hybridFixtures"],
            ["-hybridFixtures", "-moduleFlag.cameras", "native", "-hybridUnavailable"]
        ] {
            app.launchArguments = arguments
            app.launch()
            XCTAssertTrue(app.descendants(matching: .any)["web-board"].firstMatch.waitForExistence(timeout: 30))
            XCTAssertFalse(app.buttons["module-cameras"].exists)
            XCTAssertFalse(app.buttons["module-detail"].exists)
            capture(arguments.contains("-hybridUnavailable") ? "cameras-unavailable-web" : "cameras-default-web")
            app.terminate()
        }
    }

    @MainActor private func waitForImage(_ button: XCUIElement) {
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value BEGINSWITH %@", "Updated "), object: button)], timeout: 10), .completed)
    }

    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
