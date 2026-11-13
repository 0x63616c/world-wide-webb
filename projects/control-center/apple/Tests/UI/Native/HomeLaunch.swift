import XCTest

extension XCUIApplication {
    @MainActor func alignPanelOrientation() {
        if frame.width < frame.height {
            XCUIDevice.shared.orientation = .landscapeRight
            XCUIDevice.shared.orientation = .landscapeLeft
        }
    }
    @MainActor func openAppGrid() {
        alignPanelOrientation()
        // Slow simulator launches can outlast the real idle timer. The first
        // touch deliberately only wakes the panel; navigation is a second action.
        let wake = buttons["Wake panel"]
        if wake.exists {
            wake.tap()
            XCTAssertTrue(wake.waitForNonExistence(timeout: 5))
        }
        if buttons["app-back"].exists {
            buttons["app-back"].tap()
            XCTAssertTrue(buttons["app-settings"].waitForExistence(timeout: 15))
            return
        }
        if buttons["app-settings"].exists && buttons["app-settings"].isHittable { return }
        buttons["launcher-clock"].tap()
        XCTAssertTrue(buttons["app-settings"].waitForExistence(timeout: 15))
    }
    @MainActor func launchModuleFromHome(_ module: String? = nil) {
        launch()
        if launchArguments.contains("-hybridAlarmRinging") { return }
        if let module { openHomeModule(module) } else { openAppGrid() }
    }
    @MainActor func returnHomeFromModule() { openAppGrid() }
    @MainActor func selectHomeFace(_ index: Int) { openAppGrid() }
    @MainActor func openHomeModule(_ module: String) {
        openAppGrid()
        if module == "alarms" {
            open(URL(string: "controlcenter://alarms")!)
            return
        }
        let ids = [
            "lights": "lights", "climate": "climate", "fan": "climate", "wifi": "wifi", "sonos": "music",
            "weather": "weather", "photos": "photos", "calendar": "calendar", "media": "music",
            "tesla": "car", "cameras": "cameras",
        ]
        guard let id = ids[module] else {
            XCTFail("Missing app route for \(module)")
            return
        }
        buttons["app-\(id)"].tap()
        XCTAssertTrue(descendants(matching: .any)["app-screen-\(id)"].firstMatch.waitForExistence(timeout: 15))
    }
}
