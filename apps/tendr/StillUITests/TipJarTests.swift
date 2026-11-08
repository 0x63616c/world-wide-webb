import StoreKitTest
import XCTest

/// The optional tip jar, against Tendr.storekit through an SKTestSession (xcodebuild ignores the
/// scheme's StoreKit configuration for UI tests). Products load from the session; purchases use
/// `--tip-outcome`, because the simulator can ignore the session and ask for an Apple Account. With `TEST_RUNNER_SCREENSHOT_DIR` set, key states are written as PNGs.
final class TipJarTests: XCTestCase {
    private var session: SKTestSession?

    override func setUp() { continueAfterFailure = false }

    @MainActor func testSupportRowShowsThreeTipsAtTheirPrices() {
        let app = launch()
        openTipJar(app, capture: true)
        for (id, name, price) in [("tip-small", "Coffee", "$0.99"), ("tip-medium", "Croissant", "$2.99"), ("tip-large", "Gift", "$4.99")] {
            let button = app.buttons[id]
            XCTAssertTrue(button.waitForExistence(timeout: 5))
            XCTAssertTrue(button.label.contains(price), "\(id) should cost \(price), was \(button.label)")
            XCTAssertTrue(app.staticTexts[name].exists)
        }
        XCTAssertTrue(app.staticTexts["Enjoying Tendr? Leave a tip."].exists)
        // Minimal copy: no extra explanation or per-tip subtitles.
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'unlock nothing'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts["A small thank-you"].exists)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["supportTendr"].waitForExistence(timeout: 5))
    }

    @MainActor func testTipPurchaseCelebratesThenCloses() throws {
        let app = launch(extra: ["--tip-outcome", "success"])
        openTipJar(app)
        app.buttons["tip-small"].tap()
        let thanks = app.staticTexts["tipThanks"]
        XCTAssertTrue(thanks.waitForExistence(timeout: 20), "A completed tip shows the thank-you")
        // Mid-burst: the cannons fire as the cover appears.
        snap("tip-thanks", after: 0.7)
        XCTAssertTrue(app.staticTexts["Thank you"].exists)
        app.buttons["Close"].tap()
        XCTAssertTrue(app.buttons["supportTendr"].waitForExistence(timeout: 5))
        XCTAssertFalse(thanks.exists)
    }

    @MainActor func testFailedTipExplainsCalmly() throws {
        let app = launch(extra: ["--tip-outcome", "failure"])
        openTipJar(app)
        app.buttons["tip-medium"].tap()
        XCTAssertTrue(app.staticTexts["tipNotice"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["tipThanks"].exists)
        XCTAssertTrue(app.buttons["tip-medium"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tip-medium"].isEnabled, "A failed tip can be tried again")
    }

    @MainActor func testPendingTipWaitsQuietly() throws {
        let app = launch(extra: ["--tip-outcome", "pending"])
        openTipJar(app)
        app.buttons["tip-large"].tap()
        let notice = app.staticTexts["tipNotice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 15))
        XCTAssertTrue(notice.label.contains("waiting for approval"))
        XCTAssertFalse(app.staticTexts["tipThanks"].exists)
    }

    @MainActor func testThankYouCloses() {
        let app = launch(extra: ["--tip-thanks"])
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["tipThanks"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap()
        XCTAssertFalse(app.staticTexts["tipThanks"].waitForExistence(timeout: 2))
    }

    // MARK: - Helpers

    @MainActor private func launch(extra: [String] = [], configure: (SKTestSession) -> Void = { _ in }) -> XCUIApplication {
        do {
            let session = try SKTestSession(configurationFileNamed: "Tendr")
            session.resetToDefaultState()
            session.disableDialogs = true
            session.clearTransactions()
            configure(session)
            self.session = session
        } catch {
            XCTFail("Could not start the StoreKit test session: \(error)")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest", "-accentColor", "Graphite"] + extra
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 15))
        return app
    }

    @MainActor private func openTipJar(_ app: XCUIApplication, capture: Bool = false) {
        app.tabBars.buttons["Settings"].tap()
        let row = app.buttons["supportTendr"]
        // Products can take a while on a freshly booted simulator; keep scrolling until the row shows.
        let deadline = Date().addingTimeInterval(30)
        while !(row.exists && row.isHittable), Date() < deadline {
            if !row.waitForExistence(timeout: 3) || !row.isHittable { app.swipeUp() }
        }
        XCTAssertTrue(row.exists, "The row appears once the StoreKit products load")
        if capture { snap("settings-support-row", after: 0.5) }
        row.tap()
        XCTAssertTrue(app.buttons["tip-small"].waitForExistence(timeout: 5))
        if capture { snap("tip-sheet", after: 1) }
    }

    @MainActor private func snap(_ name: String, after delay: TimeInterval) {
        Thread.sleep(forTimeInterval: delay)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let directory = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !directory.isEmpty else { return }
        let url = URL(fileURLWithPath: directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
