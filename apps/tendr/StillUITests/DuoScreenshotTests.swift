import XCTest
import UIKit

/// Uses the same synthetic, in-memory fixture as ScreenshotTests. The host script
/// controls physical displays; rotation here exercises short windows independently.
final class DuoScreenshotTests: XCTestCase {
    private var controlDirectory: URL? {
        guard let path = ProcessInfo.processInfo.environment["DUO_CONTROL_DIR"], !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
    private var canFold: Bool { ProcessInfo.processInfo.environment["DUO_CAN_FOLD"] == "1" }
    private var canHostOrient: Bool { ProcessInfo.processInfo.environment["DUO_HOST_ORIENTATION"] == "1" }
    private var foldCheckpoint = 0

    override func tearDown() async throws {
        // XCTest can abort a test at a failed assertion without running its
        // Swift defer blocks. Restore an absolute physical pose in test teardown.
        let restoration = Result {
            if canHostOrient { try request("orientation", name: "portrait") }
        }
        if !canHostOrient {
            await MainActor.run { XCUIDevice.shared.orientation = .portrait }
        }
        try await super.tearDown()
        try restoration.get()
    }

    /// APP-3: inspect before touching the bar, since interaction masked the bug.
    @MainActor func testPhoneTabLabelsSurviveActivationAndSelection() throws {
        continueAfterFailure = false
        if canFold { try request("pose", name: "outer") }
        try orient(.portrait)
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
        // Both displays, native orientation menus and all capture checkpoints.
        executionTimeAllowance = 600
        for pose in canFold ? ["inner", "outer"] : ["default"] {
            if canFold { try request("pose", name: pose) }
            try orient(.portrait)
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
            try orient(.landscapeLeft, in: app)
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
        try orient(.portrait)
        let app = launchFixture()
        app.buttons["logDose"].tap()
        let amount = app.textFields["doseAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        amount.tap()
        amount.typeText("7.5")
        try orient(.landscapeRight, in: app)
        try snap("compact-height-rotation")
        var observedFrame: CGRect?
        waitUntil("Editor must resize into a short window", timeout: 45) {
            let frame = app.windows.firstMatch.frame
            if observedFrame != frame {
                print("Compact editor window: \(frame)")
                observedFrame = frame
            }
            return frame.width > frame.height && (!canFold || abs(frame.height - 466) < 1)
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

    /// The open Duo keeps the trailing system rail, rather than a leading sidebar.
    @MainActor func testSystemTabRailNavigation() throws {
        continueAfterFailure = false
        try XCTSkipUnless(canFold, "This check requires a host that can open the Duo")
        try request("pose", name: "inner")
        try orient(.portrait)
        let app = launchFixture()
        assertNavigation(for: "inner", in: app)
        try snap("native-tab-rail-home")
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
        try snap("native-tab-rail-dose-draft")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
    }

    @MainActor func testLiveFoldPreservesNavigationAndDraft() throws {
        continueAfterFailure = false
        // Five real display handoffs and captures, each with bounded waits.
        executionTimeAllowance = 600
        try XCTSkipUnless(canFold, "simctl does not expose a supported live-fold control; see capture-notes.txt")
        try request("pose", name: "inner")
        try orient(.portrait)
        let app = launchFixture()
        assertNavigation(for: "inner", in: app)
        select("Journal", in: app)
        XCTAssertTrue(app.buttons["Doses"].waitForExistence(timeout: 5))
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
        try fold(to: "outer", in: app)
        assertNavigation(for: "outer", in: app)
        XCTAssertTrue(detail.waitForExistence(timeout: 5), "Folding keeps the pushed destination")
        XCTAssertTrue(app.buttons["Live"].exists, "Folding keeps the chart selection")
        select("Progress", in: app)
        select("Home", in: app)
        XCTAssertTrue(detail.waitForExistence(timeout: 5), "Each section keeps its own stack")
        waitUntil("Returning to Home explicitly restores the live chart") { !app.buttons["Live"].exists }
        try fold(to: "inner", in: app)
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
            try fold(to: pose, in: app)
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

    @MainActor private func orient(_ orientation: UIDeviceOrientation, in app: XCUIApplication? = nil) throws {
        if canHostOrient {
            let name: String
            switch orientation {
            case .portrait: name = "portrait"
            case .landscapeLeft: name = "landscape-left"
            case .landscapeRight: name = "landscape-right"
            default: throw NSError(domain: "DuoOrientation", code: 1)
            }
            // Device Hub owns both physical orientation and the viewport. Do not
            // simultaneously drive XCTest's independent sensor on a Duo.
            try request("orientation", name: name)
        } else {
            XCUIDevice.shared.orientation = orientation
        }
        // Refresh XCTest's active-screen coordinate context after physical rotation.
        app?.activate()
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
        waitUntil("Selecting \(section) must update the active tab") {
            identified.allElementsBoundByIndex.contains { $0.isSelected } || app.tabBars.buttons[section].isSelected
        }
    }

    @MainActor private func assertNavigation(for pose: String, in app: XCUIApplication) {
        // Both displays can rotate. Their aspect ratio does not identify the
        // active display; live-fold checks require an actual window resize.
        let bounds = app.windows.firstMatch.frame
        var buttons: [XCUIElement] = []
        for section in ["Home", "Treatment", "Progress", "Journal", "Settings"] {
            let identified = app.descendants(matching: .any).matching(identifier: "nav\(section)")
            waitUntil("\(section) navigation remains reachable on \(pose)") {
                identified.allElementsBoundByIndex.contains { $0.isHittable }
            }
            guard let button = identified.allElementsBoundByIndex.first(where: { $0.isHittable }) else { return }
            XCTAssertGreaterThan(button.frame.midX, bounds.midX, "Duo navigation stays on the trailing edge on \(pose)")
            buttons.append(button)
        }
        XCTAssertFalse(app.buttons["ToggleSidebar"].isHittable, "Duo uses the system tab rail rather than an expandable sidebar")
        if let first = buttons.first, let last = buttons.last {
            XCTAssertGreaterThan(last.frame.midY, first.frame.maxY, "Duo navigation is a vertical rail on \(pose)")
        }
    }

    @MainActor private func fold(to pose: String, in app: XCUIApplication) throws {
        foldCheckpoint += 1
        if let directory = controlDirectory {
            try Data(app.debugDescription.utf8).write(
                to: directory.appendingPathComponent("live-fold-\(foldCheckpoint)-\(pose)-before.txt"), options: .atomic)
        }
        let previousSize = app.windows.firstMatch.frame.size
        try request("pose", name: pose)
        // Device Hub can switch the framebuffer before XCTest switches its
        // application's active-screen coordinate context. Activate (never launch)
        // to refresh that context without discarding the navigation stack/draft.
        app.activate()
        var observedSize: CGSize?
        var adapted = false
        // Require the full native point area, not just any smaller/larger frame:
        // XCTest can briefly report a doubly scaled outer window (155 x 226).
        let targetArea: CGFloat = pose == "inner" ? 669 * 951 : 466 * 678
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            let size = app.windows.firstMatch.frame.size
            if observedSize != size {
                print("Live fold \(pose): \(previousSize) → \(size)")
                observedSize = size
            }
            // This fixture occupies the full native display in either rotation.
            let area = size.width * size.height
            adapted = abs(area - targetArea) < targetArea * 0.01
            if adapted { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        // The new framebuffer can still be black during a resize. Capture after
        // adaptation, including on failure before XCTest aborts the assertion.
        // Its default recording follows the inactive primary display inside.
        try snap("live-fold-\(foldCheckpoint)-\(pose)")
        if let directory = controlDirectory {
            try Data(app.debugDescription.utf8).write(
                to: directory.appendingPathComponent("live-fold-\(foldCheckpoint)-\(pose)-after.txt"), options: .atomic)
        }
        XCTAssertTrue(adapted, "Folding to \(pose) must resize the active app window")
    }

    @MainActor private func waitUntil(_ message: String, timeout: TimeInterval = 10, _ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTAssertTrue(condition(), message)
    }

    @MainActor private func snap(_ name: String) throws {
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
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

    private func request(_ action: String, name: String) throws {
        let directory = try XCTUnwrap(controlDirectory)
        let id = UUID().uuidString
        let data = try JSONSerialization.data(withJSONObject: ["id": id, "action": action, "name": name])
        try data.write(to: directory.appendingPathComponent("request.json"), options: .atomic)
        // Orientation restores the active pose using two native commands, each
        // bounded to 120s by the host. Do not expire the enclosing request first.
        let deadline = Date().addingTimeInterval(270)
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
            // Native pose/rotation notifications arrive on this runner's main
            // loop. Keep it running while the host handles the request, rather
            // than deferring coordinate updates until the next XCTest action.
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTFail("Timed out waiting for the Duo simulator capture helper")
        throw NSError(domain: "DuoCapture", code: 2)
    }
}
