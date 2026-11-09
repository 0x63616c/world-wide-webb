import UIKit
import XCTest

/// Run unchanged on the panel and on the Duo's outer/inner displays.
@MainActor final class CanvasLayoutTests: XCTestCase {
    func testFullScreenClockAndStableLauncherAfterAppPop() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-hybridFixtures", "-hybridStill", "-previewDayClock",
            "-panel.idleDimming", "NO", "-updateCheckFakeBuild", "1", "-hybridBoothCamera",
        ]
        app.launch()
        defer { app.terminate() }
        let clock = app.buttons["launcher-clock"]
        XCTAssertTrue(clock.waitForExistence(timeout: 20))
        let initial = app.frame.size
        let expected: CGSize =
            max(initial.width, initial.height) >= 1100
            ? CGSize(width: 1366, height: 1024)
            : min(initial.width, initial.height) >= 600
                ? CGSize(width: 951, height: 669) : CGSize(width: 466, height: 678)
        // XCTest can keep reporting the physical device's portrait app frame
        // after a scene requests landscape. Read the actual content surface.
        let oriented = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                abs(clock.frame.width - expected.width) < 1 && abs(clock.frame.height - expected.height) < 1
            }, object: nil)
        XCTAssertEqual(
            XCTWaiter.wait(for: [oriented], timeout: 15), .completed,
            "Production canvas must request its supported orientation")
        let screen = CGRect(origin: .zero, size: expected)
        print("CANVAS_DISPLAY \(screen) XCTEST_APP \(app.frame) CLOCK \(clock.frame)")
        XCTAssertEqual(clock.frame.minX, screen.minX, accuracy: 1)
        XCTAssertEqual(clock.frame.minY, screen.minY, accuracy: 1)
        XCTAssertEqual(clock.frame.maxX, screen.maxX, accuracy: 1)
        XCTAssertEqual(clock.frame.maxY, screen.maxY, accuracy: 1)
        capture("clock", app)

        // The green artwork must reach the bottom centre, beyond the old
        // 20-point black strip (away from the device's rounded corners).
        // XCTest's main screen remains the outer display on Duo, including
        // when its app window is on the inner display. Physical Duo captures
        // are verified through simctl's explicitly selected display instead.
        if expected.width == 1366 {
            let image = XCUIScreen.main.screenshot().image
            let pixel = image.cgImage!.cropping(
                to: CGRect(
                    x: image.size.width * image.scale / 2,
                    y: (image.size.height - 2) * image.scale, width: 1, height: 1))!
            let context = CGContext(
                data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            let rgba = context.data!.assumingMemoryBound(to: UInt8.self)
            XCTAssertGreaterThan(rgba[1], 60, "Clock artwork must fill the bottom of the physical screen")
        }

        let face = clock.value as? String ?? ""
        clock.swipeLeft()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", face), object: clock)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)

        clock.tap()
        let calendar = app.buttons["app-calendar"]
        XCTAssertTrue(calendar.waitForExistence(timeout: 10))
        capture("launcher", app)
        for id in [
            "calendar", "lights", "climate", "weather", "music", "timer", "wifi", "walks", "car", "settings", "booth",
        ] {
            let button = app.buttons["app-\(id)"]
            if !button.isHittable { app.swipeUp() }
            XCTAssertTrue(button.isHittable, id)
            let anchor = button.frame
            let label = button.staticTexts.firstMatch.frame
            button.tap()
            let close = app.buttons["app-back"]
            XCTAssertTrue(close.waitForExistence(timeout: 15), id)
            XCTAssertTrue(close.isHittable, id)
            capture(id, app)
            close.tap()
            XCTAssertTrue(button.waitForExistence(timeout: 10))
            // Returning restores the same content, rather than a new text layout.
            XCTAssertEqual(button.frame.minX, anchor.minX, accuracy: 1)
            XCTAssertEqual(button.frame.minY, anchor.minY, accuracy: 1)
            XCTAssertEqual(button.frame.size.width, anchor.width, accuracy: 1)
            XCTAssertEqual(button.frame.size.height, anchor.height, accuracy: 1)
            XCTAssertEqual(button.staticTexts.firstMatch.frame, label)
        }
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "canvas-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
