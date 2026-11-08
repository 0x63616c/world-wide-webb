import XCTest
import UIKit

@MainActor final class ScreenshotTests: XCTestCase {
    func testJournalScreensAndSearch() throws {
        try exerciseJournal(appearance: "light")
    }
    func testDarkJournalScreensAndSearch() throws {
        try exerciseJournal(appearance: "dark")
    }
    func testGlobeClearsFlightCard() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "--dark"]
        app.launch()
        XCTAssertTrue(app.buttons["Flights"].waitForExistence(timeout: 15))
        app.buttons["Flights"].tap()
        if app.buttons["Show Sidebar"].exists { app.buttons["Show Sidebar"].tap() }
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'flight-'")).firstMatch
        if row.exists { row.tap() }
        else { app.cells.containing(NSPredicate(format: "label CONTAINS 'JFK'")).firstMatch.tap() }
        let identity = app.otherElements["flightIdentity"].firstMatch
        let globe = app.otherElements["flightGlobe"].firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 5))
        XCTAssertTrue(globe.exists)
        expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: globe)
        waitForExpectations(timeout: 5)
        XCTAssertLessThanOrEqual(globe.frame.maxY, identity.frame.minY, "Globe must stay above the flight card")
        capture("dark-flight-layout")
    }
    private func exerciseJournal(appearance: String) throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "--\(appearance)"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Total distance"].waitForExistence(timeout: 15))
        capture("\(appearance)-overview")
        app.buttons["Import flight history"].tap()
        XCTAssertTrue(app.buttons["chooseCSV"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["chooseCSV"].label, "Choose CSV")
        capture("\(appearance)-import")
        app.buttons["chooseCSV"].tap()
        XCTAssertTrue(app.buttons["Cancel"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["Cancel"].firstMatch.tap()
        let motion = app.buttons["globeMotion"]
        XCTAssertTrue(motion.exists)
        motion.tap()
        XCTAssertEqual(motion.label, "Rotate globe")
        motion.tap()
        XCTAssertEqual(motion.label, "Pause globe")
        let globe = app.otherElements["flightGlobe"].firstMatch
        XCTAssertTrue(globe.exists)
        let initialGlobeHeight = globe.frame.height
        let initialZoom = globe.value as? String
        globe.pinch(withScale: 1.4, velocity: 1)
        XCTAssertNotEqual(globe.value as? String, initialZoom, "Pinch must change the camera zoom")
        XCTAssertEqual(globe.frame.height, initialGlobeHeight, accuracy: 1, "Zoom must not push adjacent content")
        XCTAssertTrue(app.buttons["Reset globe"].waitForExistence(timeout: 5))
        XCTAssertEqual(motion.label, "Rotate globe")
        capture("\(appearance)-zoom")
        app.buttons["Reset globe"].tap()
        app.buttons["viewAllFlights"].tap()
        capture("\(appearance)-journal")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("HND")
        XCTAssertTrue(app.staticTexts["2 flights"].waitForExistence(timeout: 5))
        capture("\(appearance)-search")
        let firstFlight = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'flight-'")).firstMatch
        if firstFlight.exists { firstFlight.tap() }
        else { app.cells.containing(NSPredicate(format: "label CONTAINS 'HND'")).firstMatch.tap() }
        XCTAssertTrue(app.staticTexts["United"].waitForExistence(timeout: 5))
        capture("\(appearance)-flight")
        if !app.staticTexts["Arrived 8 min early"].isHittable {
            app.scrollViews.element(boundBy: app.scrollViews.count - 1).swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Arrived 8 min early"].waitForExistence(timeout: 5))
        app.buttons["operationDetails"].tap()
        XCTAssertTrue(app.staticTexts["Tail number, N000EX"].waitForExistence(timeout: 5))
        capture("\(appearance)-operations")
        app.buttons["operationDetails"].tap()
        let booking = app.buttons["bookingDetails"]
        if !booking.isHittable { app.scrollViews.element(boundBy: app.scrollViews.count - 1).swipeUp() }
        XCTAssertTrue(booking.waitForExistence(timeout: 5))
        booking.tap()
        XCTAssertTrue(app.staticTexts["Booked seat, 24A"].waitForExistence(timeout: 5))
        capture("\(appearance)-booking")
        booking.tap()
        let observation = app.buttons["aircraftObservation"]
        XCTAssertTrue(observation.waitForExistence(timeout: 5))
        observation.tap()
        XCTAssertTrue(app.staticTexts["Aircraft type, B789"].waitForExistence(timeout: 5))
        capture("\(appearance)-aircraft")
        let passport = app.buttons["Passport"]
        if passport.exists { passport.tap() } else { app.tabBars.buttons["Passport"].tap() }
        XCTAssertTrue(app.staticTexts["Passport"].waitForExistence(timeout: 5))
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
