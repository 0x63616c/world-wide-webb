import XCTest
import UIKit

@MainActor final class ScreenshotTests: XCTestCase {
    func testJournalScreensAndSearch() throws {
        try exerciseJournal(appearance: "light")
    }
    func testDarkJournalScreensAndSearch() throws {
        try exerciseJournal(appearance: "dark")
    }
    private func exerciseJournal(appearance: String) throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "--\(appearance)"]
        app.launch()
        XCTAssertTrue(app.staticTexts["A world of memories."].waitForExistence(timeout: 15))
        capture("\(appearance)-overview")
        app.buttons["viewAllFlights"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("HND")
        XCTAssertTrue(app.staticTexts["2 FLIGHTS"].waitForExistence(timeout: 5))
        capture("\(appearance)-search")
        let firstFlight = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'flight-'")).firstMatch
        if firstFlight.exists { firstFlight.tap() }
        else { app.cells.containing(NSPredicate(format: "label CONTAINS 'HND'")).firstMatch.tap() }
        XCTAssertTrue(app.staticTexts["Flight memory"].exists || app.staticTexts["FLIGHT MEMORY"].waitForExistence(timeout: 5))
        capture("\(appearance)-flight")
        let passport = app.buttons["Passport"]
        if passport.exists { passport.tap() } else { app.tabBars.buttons["Passport"].tap() }
        XCTAssertTrue(app.staticTexts["Your passport."].waitForExistence(timeout: 5))
        capture("\(appearance)-passport")
    }
    private func capture(_ name: String) {
        var captured = 0
        // Duo's main screen can be the inactive cover. Inspect every screen
        // and reject blank captures so successful tests also yield usable images.
        for (index, screen) in XCUIScreen.screens.enumerated() {
            let shot = screen.screenshot()
            guard let image = shot.image.cgImage else { continue }
            var samples = [UInt8](repeating: 0, count: 64 * 64)
            samples.withUnsafeMutableBytes { bytes in
                let context = CGContext(data: bytes.baseAddress, width: 64, height: 64, bitsPerComponent: 8, bytesPerRow: 64,
                                        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
                context?.draw(image, in: CGRect(x: 0, y: 0, width: 64, height: 64))
            }
            guard Int(samples.max() ?? 0) - Int(samples.min() ?? 0) > 15 else { continue }
            let attachment = XCTAttachment(screenshot: shot)
            attachment.name = "\(name)-screen\(index)"
            attachment.lifetime = .keepAlways
            add(attachment)
            captured += 1
        }
        XCTAssertGreaterThan(captured, 0, "No active, nonblank screenshot for \(name)")
    }
}
