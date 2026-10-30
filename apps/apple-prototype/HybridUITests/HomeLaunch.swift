import XCTest

extension XCUIApplication {
    /// Exercise the shipped Home entry before the existing provider/controller suites.
    @MainActor func launchModuleFromHome() {
        launch()
        if launchArguments.contains("-hybridAlarmRinging") { return }
        let order = ["lights", "climate", "fan", "wifi", "sonos", "weather", "photos", "walk",
                     "alarms", "calendar", "media", "tesla", "cameras"]
        let module = order.first { launchArguments.contains("-moduleFlag.\($0)") }
        guard let module else {
            XCTAssertTrue(buttons["home-classic"].waitForExistence(timeout: 30))
            buttons["home-classic"].tap()
            return
        }
        openHomeModule(module)
        let native = launchArguments.firstIndex(of: "-moduleFlag.\(module)")
            .map { launchArguments[$0 + 1] == "native" } ?? false
        if native && !launchArguments.contains("-hybridUnavailable") && !launchArguments.contains("-hybridDetail") {
            if module == "wifi", buttons["wifi-fullscreen-qr"].waitForExistence(timeout: 5) {
                buttons["wifi-fullscreen-qr"].tap()
            }
            let toggle = buttons["module-detail"]
            XCTAssertTrue(toggle.waitForExistence(timeout: 30))
            toggle.tap() // Existing suites exercise both the leaf tile and its controller.
        }
    }

    @MainActor func openHomeModule(_ module: String) {
        let tiles = ["lights": "lamps", "climate": "climate", "fan": "fan", "wifi": "wifi",
                     "sonos": "sound", "weather": "weather", "photos": "photos", "walk": "dogwalk",
                     "alarms": "clock", "calendar": "calendar", "media": "media", "tesla": "tesla", "cameras": "cameras"]
        let tile = tiles[module]!
        XCTAssertTrue(buttons["home-classic"].waitForExistence(timeout: 30))
        // Home's Classic button stays in the covered host's AX tree. The pager
        // returns only after the selected controller has finished dismissing.
        let page = buttons[["wifi", "photos", "walk", "alarms", "media", "cameras"].contains(module) ? "face-page-1" : "face-page-0"]
        XCTAssertTrue(page.waitForExistence(timeout: 30))
        page.tap()
        let container = descendants(matching: .any)["tile-\(tile)"].firstMatch
        XCTAssertTrue(container.waitForExistence(timeout: 15))
        if !launchArguments.contains("-hybridUnavailable") {
            XCTAssertTrue(buttons["tile-unavailable-\(tile)"].waitForNonExistence(timeout: 30))
        }
        if module == "fan" && !launchArguments.contains("-hybridUnavailable") {
            container.buttons.element(boundBy: 1).tap()
        } else { container.buttons.firstMatch.tap() }
    }
}
