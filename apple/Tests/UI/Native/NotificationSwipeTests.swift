import XCTest

@MainActor final class NotificationSwipeTests: XCTestCase {
    func testHistoryClearActionHasVisibleLabel() {
        let app = XCUIApplication()
        app.launchArguments = ["-notificationCapture", "history", "-notificationHold"]
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "notification-history-item-"))
            .firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Clear"].waitForExistence(timeout: 5))
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "notification-clear-action"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
