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
        if buttons["app-settings"].exists && buttons["app-settings"].isHittable { return }
        let window = windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).press(forDuration: 0.1,
            thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
        XCTAssertTrue(buttons["app-settings"].waitForExistence(timeout: 15))
    }
    @MainActor func launchModuleFromHome() {
        launch()
        if launchArguments.contains("-hybridAlarmRinging") { return }
        let order = ["lights", "climate", "fan", "wifi", "sonos", "weather", "photos", "walk", "alarms", "calendar", "media", "tesla", "cameras"]
        if let module = order.first(where: { launchArguments.contains("-moduleFlag.\($0)") }) { openHomeModule(module) }
        else { openAppGrid(); buttons["app-classic"].tap() }
    }
    @MainActor func returnHomeFromModule() { openAppGrid() }
    @MainActor func selectHomeFace(_ index: Int) { openAppGrid() }
    @MainActor func openHomeModule(_ module: String) {
        openAppGrid()
        if module == "alarms" {
            if launchArguments.contains("-hybridUnavailable") || launchArguments.contains("web") { buttons["app-classic"].tap() }
            else { open(URL(string: "controlcenter://alarms")!) }
            return
        }
        let ids = ["lights": "lights", "climate": "climate", "fan": "climate", "wifi": "wifi", "sonos": "music", "weather": "weather", "photos": "photos", "walk": "walks", "calendar": "calendar", "media": "music", "tesla": "car", "cameras": "cameras"]
        guard let id = ids[module] else { XCTFail("Missing app route for \(module)"); return }
        buttons["app-\(id)"].tap()
        XCTAssertTrue(descendants(matching: .any)["app-screen-\(id)"].firstMatch.waitForExistence(timeout: 15))
    }
}
