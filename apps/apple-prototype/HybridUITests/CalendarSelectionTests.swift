import XCTest

final class CalendarSelectionTests: XCTestCase {
    @MainActor func testPickerFiltersAgendaAndHomeAndPersistsAcrossLaunch() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication(bundleIdentifier: "co.worldwidewebb.theworkflowengine")
        app.launchArguments = ["-hybridFixtures", "-hybridStill", "-moduleFlag.calendar", "native"]
        app.launchModuleFromHome()
        app.buttons["calendar-picker"].tap()
        XCTAssertTrue(app.buttons["calendar-show-all"].waitForExistence(timeout: 10))
        app.buttons["calendar-show-all"].tap()
        let work = app.switches["calendar-selection-fixture_work"]
        XCTAssertTrue(work.waitForExistence(timeout: 10))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND value == '1'"), object: work)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 10), .completed)
        work.tap()
        app.buttons["calendar-picker-done"].tap()
        XCTAssertTrue(app.staticTexts["Design workshop"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Community day"].exists)
        capture("calendar-filtered-agenda")
        app.returnHomeFromModule()
        XCTAssertTrue(app.staticTexts["Design workshop"].waitForNonExistence(timeout: 10))
        capture("calendar-filtered-home")
        app.terminate()
        app.launchModuleFromHome()
        XCTAssertTrue(app.staticTexts["Design workshop"].waitForNonExistence(timeout: 10))
        app.buttons["calendar-picker"].tap()
        XCTAssertEqual(work.value as? String, "0")
        capture("calendar-picker-persisted")
        let personal = app.switches["calendar-selection-fixture_personal"]
        personal.tap()
        app.buttons["calendar-picker-done"].tap()
        XCTAssertTrue(app.staticTexts["No upcoming events in the selected calendars."].waitForExistence(timeout: 10))
        app.buttons["calendar-picker"].tap()
        app.buttons["calendar-show-all"].tap()
        app.buttons["calendar-picker-done"].tap()
        XCTAssertTrue(app.staticTexts["Design workshop"].waitForExistence(timeout: 10))
        app.terminate()
    }

    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
