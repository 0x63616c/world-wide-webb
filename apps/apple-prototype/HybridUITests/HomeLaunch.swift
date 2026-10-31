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
            let toggle = buttons["module-detail"]
            XCTAssertTrue(toggle.waitForExistence(timeout: 30))
            toggle.tap() // Existing suites exercise both the leaf tile and its controller.
        }
    }

    @MainActor func returnHomeFromModule() {
        let qr = buttons["wifi-fullscreen-qr"]
        if qr.exists && qr.isHittable {
            qr.tap()
            XCTAssertTrue(qr.waitForNonExistence(timeout: 10))
        }
        buttons["module-home"].tap()
        let pager = buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "face-page-")).firstMatch
        XCTAssertTrue(pager.waitForExistence(timeout: 30))
    }

    @MainActor func openHomeModule(_ module: String) {
        let tiles = ["lights": "lamps", "climate": "climate", "fan": "fan", "wifi": "wifi",
                     "sonos": "sound", "weather": "weather", "photos": "photos", "walk": "dogwalk",
                     "alarms": "clock", "calendar": "calendar", "media": "media", "tesla": "tesla", "cameras": "cameras"]
        let tile = tiles[module]!
        XCTAssertTrue(buttons["home-classic"].waitForExistence(timeout: 30))
        // Home's Classic button stays in the covered host's AX tree. The pager
        // returns only after the selected controller has finished dismissing.
        // WWW-54 grid Home: page 2 holds Now Playing and the modules without a grid card.
        let page = buttons[["wifi", "photos", "walk", "media", "cameras", "sonos"].contains(module) ? "face-page-2" : "face-page-1"]
        XCTAssertTrue(page.waitForExistence(timeout: 30))
        page.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Selected"), object: page)
        if XCTWaiter.wait(for: [selected], timeout: 5) != .completed {
            page.tap() // Replay an absolute selection if a system interruption consumed the tap.
            let retried = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Selected"), object: page)
            XCTAssertEqual(XCTWaiter.wait(for: [retried], timeout: 5), .completed)
        }
        let container = descendants(matching: .any)["tile-\(tile)"].firstMatch
        XCTAssertTrue(container.waitForExistence(timeout: 15))
        if !launchArguments.contains("-hybridUnavailable") {
            XCTAssertTrue(buttons["tile-unavailable-\(tile)"].waitForNonExistence(timeout: 30))
        }
        // Grid cards open from anywhere outside their inline controls; the older
        // module tiles on page 2 keep their own open buttons.
        let gridCards = ["lamps", "climate", "fan", "sound", "weather", "clock", "calendar", "tesla"]
        if gridCards.contains(tile) { container.tap() } else { container.buttons.firstMatch.tap() }
        if module == "wifi", !launchArguments.contains("-hybridUnavailable"),
           !launchArguments.contains("-hybridDetail"),
           let index = launchArguments.firstIndex(of: "-moduleFlag.wifi"),
           launchArguments[index + 1] == "native" {
            let qr = buttons["wifi-fullscreen-qr"]
            XCTAssertTrue(qr.waitForExistence(timeout: 15))
            qr.tap() // Inspect the controller beneath its initial QR presentation.
        }
    }
}
