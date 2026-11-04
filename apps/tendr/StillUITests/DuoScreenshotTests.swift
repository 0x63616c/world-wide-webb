import XCTest

/// Uses the same synthetic, in-memory fixture as ScreenshotTests. The host script
/// controls physical displays; rotation here exercises short windows independently.
final class DuoScreenshotTests: XCTestCase {
    private var controlDirectory: URL? {
        guard let path = ProcessInfo.processInfo.environment["DUO_CONTROL_DIR"], !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
    private var canFold: Bool { ProcessInfo.processInfo.environment["DUO_CAN_FOLD"] == "1" }

    /// APP-3: inspect before touching the bar, since interaction masked the bug.
    @MainActor func testPhoneTabLabelsSurviveActivationAndSelection() throws {
        continueAfterFailure = false
        if canFold { try request("pose", name: "outer") }
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchFixture()
        assertPhoneTabs(in: app, checkpoint: "launch")

        // Hardware Home targets the primary screen. Keep the background check
        // on single-screen phones; Duo's inner-display lifecycle needs a host check.
        if XCUIScreen.screens.count == 1 {
            XCUIDevice.shared.press(.home)
            waitUntil("Home must background the app") {
                app.state == .runningBackground || app.state == .runningBackgroundSuspended
            }
        }
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
        assertPhoneTabs(in: app, checkpoint: "reactivation")

        for section in ["Treatment", "Progress", "Journal", "Settings", "Home"] {
            select(section, in: app)
            let title = section == "Home" ? "Tendr" : section
            XCTAssertTrue(app.staticTexts["pageHeader-\(title)"].waitForExistence(timeout: 5))
            assertPhoneTabs(in: app, checkpoint: "selected \(section)")
        }
    }

    @MainActor private func assertPhoneTabs(in app: XCUIApplication, checkpoint: String) {
        for section in ["Home", "Treatment", "Progress", "Journal", "Settings"] {
            let identified = app.descendants(matching: .any).matching(identifier: "nav\(section)")
            waitUntil("Missing \(section) at \(checkpoint)") {
                identified.allElementsBoundByIndex.contains { $0.isHittable } || app.tabBars.buttons[section].isHittable
            }
            let button = identified.allElementsBoundByIndex.first { $0.isHittable } ?? app.tabBars.buttons[section]
            XCTAssertEqual(button.label, section)
            XCTAssertTrue(button.isHittable, "Unreachable \(section) at \(checkpoint)")
        }
        // Accessibility titles can survive a missing rendered title. Keep visual
        // evidence as well; these assertions alone cannot prove glyph visibility.
        for (index, screen) in XCUIScreen.screens.enumerated() {
            let attachment = XCTAttachment(screenshot: screen.screenshot())
            attachment.name = "APP-3 tab labels: \(checkpoint), screen \(index)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    @MainActor func testMainScreens() throws {
        continueAfterFailure = false
        defer { XCUIDevice.shared.orientation = .portrait }
        for pose in canFold ? ["inner", "outer"] : ["default"] {
            if canFold { try request("pose", name: pose) }
            XCUIDevice.shared.orientation = .portrait
            let app = launchFixture()
            if canFold { assertNavigation(for: pose, in: app) }
            try snap("home")

            select("Treatment", in: app)
            XCTAssertTrue(app.buttons["editSchedule"].waitForExistence(timeout: 5))
            try snap("treatment")
            select("Progress", in: app)
            XCTAssertTrue(app.descendants(matching: .any)["currentWeightCard"].waitForExistence(timeout: 5))
            try snap("progress")
            select("Journal", in: app)
            XCTAssertTrue(app.buttons["Doses"].waitForExistence(timeout: 5))
            app.buttons["Doses"].tap()
            XCTAssertTrue(app.staticTexts["7.5 mg · Weekly medication"].firstMatch.waitForExistence(timeout: 5))
            try snap("journal")
            select("Settings", in: app)
            XCTAssertTrue(app.staticTexts["pageHeader-Settings"].waitForExistence(timeout: 5))
            try snap("settings")

            select("Home", in: app)
            app.buttons["logDose"].tap()
            let amount = app.textFields["doseAmount"]
            XCTAssertTrue(amount.waitForExistence(timeout: 5))
            amount.tap()
            amount.typeText("7.5")
            try snap("log-dose")
            XCUIDevice.shared.orientation = .landscapeLeft
            // Inner displays and centered sheets need not adopt the requested
            // device orientation. Verify the draft/actions in the resulting layout.
            XCTAssertEqual(amount.value as? String, "7.5", "Rotation must preserve an unsaved dose")
            XCTAssertTrue(app.buttons["saveDose"].isHittable, "Save stays above the keyboard")
            try snap("landscape-log-dose")
            app.buttons["Cancel"].tap()
            XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
            try snap("landscape-home")
            select("Progress", in: app)
            try snap("landscape-progress")
            app.terminate()
        }
    }

    @MainActor func testEditorActionsSurviveCompactHeight() throws {
        continueAfterFailure = false
        if canFold { try request("pose", name: "outer") }
        try XCTSkipIf(!canFold && XCUIScreen.screens.count > 1,
                      "The host cannot select the outer display for a compact-height check")
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchFixture()
        app.buttons["logDose"].tap()
        let amount = app.textFields["doseAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        amount.tap()
        amount.typeText("7.5")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitUntil("Editor must resize into a short window") {
            let frame = app.windows.firstMatch.frame
            return frame.width > frame.height
        }
        XCTAssertEqual(amount.value as? String, "7.5")
        XCTAssertTrue(app.buttons["saveDose"].isHittable)
        XCTAssertTrue(app.buttons["Cancel"].isHittable)
        try snap("landscape-editor-actions")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
    }

    @MainActor func testAccessibilitySizeKeepsSectionsReachable() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
        try snap("accessibility-home")
        for section in ["Treatment", "Progress", "Journal", "Settings"] {
            select(section, in: app)
            XCTAssertTrue(app.staticTexts["pageHeader-\(section)"].waitForExistence(timeout: 5))
            try snap("accessibility-\(section.lowercased())")
        }
    }

    /// Run on the open Duo display. Compact-only runs retain the tab regression below.
    @MainActor func testSystemSidebarNavigation() throws {
        continueAfterFailure = false
        let app = launchFixture()
        let toggle = app.buttons["ToggleSidebar"]
        let initialControl = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "sidebar"))
            .allElementsBoundByIndex.first { $0.isHittable }
        try XCTSkipUnless(initialControl != nil, "This check requires an open, regular-width display")
        if !toggle.isHittable { initialControl?.tap() }
        assertNavigation(for: "inner", in: app)
        try snap("system-sidebar-home")
        toggle.tap()
        waitUntil("System sidebar hides") { !app.descendants(matching: .any)["navJournal"].firstMatch.isHittable }
        let restore = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "sidebar")).allElementsBoundByIndex.first { $0.isHittable }
        XCTAssertNotNil(restore, "System restore control remains reachable")
        restore?.tap()
        assertNavigation(for: "inner", in: app)
        for section in ["Treatment", "Progress", "Journal", "Settings"] {
            select(section, in: app)
            XCTAssertTrue(app.staticTexts["pageHeader-\(section)"].waitForExistence(timeout: 5))
        }
        select("Home", in: app)
        app.buttons["logDose"].tap()
        let amount = app.textFields["doseAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        amount.tap()
        amount.typeText("7.5")
        XCTAssertTrue(app.buttons["saveDose"].isHittable)
        try snap("system-sidebar-dose-draft")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
    }

    @MainActor func testLiveFoldPreservesNavigationAndDraft() throws {
        continueAfterFailure = false
        try XCTSkipUnless(canFold, "simctl does not expose a supported live-fold control; see capture-notes.txt")
        defer { XCUIDevice.shared.orientation = .portrait }
        try request("pose", name: "inner")
        XCUIDevice.shared.orientation = .portrait
        let app = launchFixture()
        assertNavigation(for: "inner", in: app)
        // Section navigation must remain recoverable after hiding the sidebar.
        let toggle = app.buttons["ToggleSidebar"]
        toggle.tap()
        waitUntil("Sidebar can be hidden") { !app.descendants(matching: .any)["navJournal"].firstMatch.isHittable }
        let restore = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "sidebar")).allElementsBoundByIndex.first { $0.isHittable }
        XCTAssertNotNil(restore)
        restore?.tap()
        assertNavigation(for: "inner", in: app)
        select("Journal", in: app)
        app.buttons["Doses"].tap()
        select("Home", in: app)
        let card = app.descendants(matching: .any)["medicationCard"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        card.tap()
        let detail = app.descendants(matching: .any)["medicationDetailChart"].firstMatch
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.5))
            .press(forDuration: 0.2, thenDragTo: detail.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)))
        XCTAssertTrue(app.buttons["Live"].waitForExistence(timeout: 3), "Scrubbing selects a past time")
        try request("pose", name: "outer")
        assertNavigation(for: "outer", in: app)
        XCTAssertTrue(detail.waitForExistence(timeout: 5), "Folding keeps the pushed destination")
        XCTAssertTrue(app.buttons["Live"].exists, "Folding keeps the chart selection")
        select("Progress", in: app)
        select("Home", in: app)
        XCTAssertTrue(detail.waitForExistence(timeout: 5), "Each section keeps its own stack")
        waitUntil("Returning to Home explicitly restores the live chart") { !app.buttons["Live"].exists }
        try request("pose", name: "inner")
        assertNavigation(for: "inner", in: app)
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        select("Journal", in: app)
        XCTAssertTrue(app.buttons["Doses"].isSelected, "Journal filter survives folding and section changes")
        select("Home", in: app)
        let systemBack = app.descendants(matching: .any)["BackButton"].firstMatch
        let back = systemBack.exists ? systemBack : app.navigationBars["Medication"].buttons["Back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
        app.buttons["logDose"].tap()
        let amount = app.textFields["doseAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        amount.tap()
        amount.typeText("7.5")
        for pose in ["outer", "inner", "outer"] {
            let previousSize = app.windows.firstMatch.frame.size
            try request("pose", name: pose)
            waitUntil("A fold must resize the app window while the sheet is open") {
                app.windows.firstMatch.frame.size != previousSize
            }
            XCTAssertTrue(amount.waitForExistence(timeout: 5), "The sheet stays presented")
            XCTAssertEqual(amount.value as? String, "7.5", "Folding keeps the unsaved draft")
            XCTAssertTrue(app.buttons["saveDose"].isHittable)
        }
        app.buttons["Cancel"].tap()
        assertNavigation(for: "outer", in: app)
    }

    @MainActor private func launchFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--screenshots", "-accentColor", "Graphite"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
        return app
    }

    @MainActor private func select(_ section: String, in app: XCUIApplication) {
        let identified = app.descendants(matching: .any).matching(identifier: "nav\(section)")
        if let button = identified.allElementsBoundByIndex.first(where: { $0.isHittable }) {
            button.tap()
        } else {
            let tab = app.tabBars.buttons[section]
            XCTAssertTrue(tab.waitForExistence(timeout: 5), "Section must be reachable in either layout")
            tab.tap()
        }
    }

    @MainActor private func assertNavigation(for pose: String, in app: XCUIApplication) {
        let home = app.descendants(matching: .any)["navHome"].firstMatch
        let sidebarToggle = app.buttons["ToggleSidebar"]
        waitUntil("Home navigation must remain reachable") { home.isHittable }
        if pose == "inner" {
            XCTAssertTrue(sidebarToggle.isHittable, "Inner display exposes the native sidebar")
        } else {
            XCTAssertFalse(sidebarToggle.isHittable, "Outer display uses system tabs, which may be vertical")
        }
    }

    @MainActor private func waitUntil(_ message: String, timeout: TimeInterval = 10, _ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        XCTAssertTrue(condition(), message)
    }

    @MainActor private func snap(_ name: String) throws {
        Thread.sleep(forTimeInterval: 1.5)
        // App-window screenshots can crop incorrectly during rotation. Capture
        // every active screen instead; the host maps named Duo displays separately.
        for (index, screen) in XCUIScreen.screens.enumerated() {
            let shot = screen.screenshot()
            let suffix = index == 0 ? "" : "-screen\(index)"
            let attachment = XCTAttachment(screenshot: shot)
            attachment.name = name + suffix
            attachment.lifetime = .keepAlways
            add(attachment)
            if controlDirectory == nil, let directory = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] {
                let url = URL(fileURLWithPath: directory, isDirectory: true)
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                try shot.pngRepresentation.write(to: url.appendingPathComponent("default-\(name)\(suffix).png"))
            }
        }
        if controlDirectory != nil {
            try request("capture", name: name)
        }
    }

    @MainActor private func request(_ action: String, name: String) throws {
        let directory = try XCTUnwrap(controlDirectory)
        let id = UUID().uuidString
        let data = try JSONSerialization.data(withJSONObject: ["id": id, "action": action, "name": name])
        try data.write(to: directory.appendingPathComponent("request.json"), options: .atomic)
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            if let responseData = try? Data(contentsOf: directory.appendingPathComponent("response.json")),
               let response = (try? JSONSerialization.jsonObject(with: responseData)) as? [String: Any],
               response["id"] as? String == id {
                guard response["ok"] as? Bool == true else {
                    XCTFail(response["error"] as? String ?? "Duo capture failed")
                    throw NSError(domain: "DuoCapture", code: 1)
                }
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        XCTFail("Timed out waiting for the Duo simulator capture helper")
        throw NSError(domain: "DuoCapture", code: 2)
    }
}
