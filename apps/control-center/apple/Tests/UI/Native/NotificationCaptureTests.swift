import UIKit
import XCTest

/// Keep device orientation under XCTest control through the actual screenshot.
/// simctl captures after the runner exits can contain a portrait, letterboxed app.
final class NotificationCaptureTests: XCTestCase {
    @MainActor func testNotificationStyleOptions() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        for style in ["classic", "compact", "airy"] {
            app.launchArguments = [
                "-notificationCapture", "single", "-notificationHold", "-previewNotificationStyle", style,
            ]
            app.launch()
            app.alignPanelOrientation()
            XCTAssertTrue(app.buttons["notification-banner-updates"].waitForExistence(timeout: 20))
            let attachment = XCTAttachment(image: normalizedImage(app))
            attachment.name = "notification-option-\(style)"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
    }

    @MainActor func testLandscapeReviewCaptures() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        for state in ["single", "stacked", "expanded", "swipe"] {
            app.launchArguments = ["-notificationCapture", state, "-notificationHold"]
            app.launch()
            XCTAssertTrue(app.buttons["notification-banner-updates"].waitForExistence(timeout: 20))
            if state == "expanded" {
                XCTAssertTrue(app.buttons["notification-stack-collapse"].exists)
                XCTAssertTrue(app.buttons["notification-banner-calendar"].exists)
            }
            XCTAssertEqual(app.frame.width, 1366, accuracy: 1)
            XCTAssertEqual(app.frame.height, 1024, accuracy: 1)
            let screenshot = app.windows.firstMatch.screenshot()
            XCTAssertEqual(screenshot.image.size.width / screenshot.image.size.height, 1366.0 / 1024.0, accuracy: 0.01)
            let attachment = XCTAttachment(image: normalizedImage(app))
            attachment.name = "mac-\(state)"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
    }
    @MainActor private func normalizedImage(_ app: XCUIApplication) -> UIImage {
        let image = app.windows.firstMatch.screenshot().image
        // PNG attachments must bake in UIImage's orientation before export.
        return UIGraphicsImageRenderer(size: image.size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }

}
