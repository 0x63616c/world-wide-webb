import XCTest

extension XCUIApplication {
    /// Existing module suites still exercise the same leaf routes, reached from Home.
    @MainActor func launchModuleFromHome() {
        launch()
        let arguments = launchArguments
        if arguments.contains("-hybridAlarmRinging") { return }
        let order = ["lights", "climate", "fan", "wifi", "sonos", "weather", "photos", "walk",
                     "reminders", "alarms", "calendar", "media", "tesla", "cameras"]
        guard let module = order.first(where: { module in
            guard let index = arguments.firstIndex(of: "-moduleFlag.\(module)"), index + 1 < arguments.count else { return false }
            return arguments[index + 1] == "native"
        }) else { return }
        let tile = buttons["home-\(module)"]
        XCTAssertTrue(tile.waitForExistence(timeout: 30))
        if !tile.isHittable { swipeUp() }
        tile.tap()
        if arguments.contains("-hybridDetail"), buttons["module-detail"].waitForExistence(timeout: 15) {
            buttons["module-detail"].tap()
        }
    }
}
