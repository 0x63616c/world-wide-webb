import WebKit
import XCTest
@testable import Panel

final class KioskSessionTests: XCTestCase {
    @MainActor
    private func makeSession() throws -> KioskSession {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "PanelTests.session"))
        return KioskSession(configuration: PanelConfiguration(info: [:], defaults: defaults, environment: [:]))
    }

    @MainActor
    func testRecoveryRemountsOnlyOnceForRepeatedErrors() async throws {
        let session = try makeSession()
        defer { session.stop() }
        session.recover()
        session.recover()
        XCTAssertTrue(session.reconnecting)
        try await Task.sleep(for: .milliseconds(1200))
        XCTAssertEqual(session.generation, 1)
        XCTAssertTrue(session.reconnecting)
    }

    @MainActor
    func testSuccessfulBootCancelsPendingRecovery() async throws {
        let session = try makeSession()
        defer { session.stop() }
        session.recover()
        session.receive(BootReport(channel: "control-center-shell", rendered: true))
        try await Task.sleep(for: .milliseconds(1200))
        XCTAssertEqual(session.generation, 0)
        XCTAssertFalse(session.reconnecting)
    }

    @MainActor
    func testAlarmFallbackStoresSnapshotAndReturnsFailure() throws {
        let name = "PanelTests.alarms"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let alarms = PanelAlarms(defaults: defaults)
        let session = KioskSession(configuration: PanelConfiguration(info: [:], defaults: defaults, environment: [:]), alarms: alarms)
        defer { session.stop() }
        let request = try XCTUnwrap(NativeRequest.parse(#"{"channel":"control-center-native","id":"request-test","method":"syncNextAlarm","params":{"next":null}}"#))
        let response = session.handle(request, in: WKWebView())
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error, PanelAlarms.unavailableMessage)
        let data = try XCTUnwrap(defaults.data(forKey: "panel.pendingAlarmSnapshot"))
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: data), .object(["next": .null]))
    }

    @MainActor
    func testBridgeRejectsUnsupportedMethodAndUnsafeBrowserURL() throws {
        let session = try makeSession()
        defer { session.stop() }
        for raw in [#"{"channel":"control-center-native","id":"request-test","method":"unknown"}"#,
                    #"{"channel":"control-center-native","id":"request-test","method":"openBrowser","params":{"url":"javascript:alert(1)"}}"#] {
            XCTAssertFalse(session.handle(try XCTUnwrap(NativeRequest.parse(raw)), in: WKWebView()).ok)
        }
        XCTAssertNil(session.browser)
    }
}
