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
    func testAlarmBridgeSyncsNullSnapshotAndReturnsSuccess() async throws {
        let name = "PanelTests.alarms"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let coordinator = AlarmCoordinatorSpy()
        let alarms = PanelAlarms(coordinator: coordinator)
        let session = KioskSession(configuration: PanelConfiguration(info: [:], defaults: defaults, environment: [:]), alarms: alarms)
        defer { session.stop() }
        let request = try XCTUnwrap(NativeRequest.parse(#"{"channel":"control-center-native","id":"request-test","method":"syncNextAlarm","params":{"next":null}}"#))
        let response = await session.handle(request, in: WKWebView())
        XCTAssertEqual(response, .success(id: "request-test"))
        let snapshots = await coordinator.snapshots
        XCTAssertEqual(snapshots, [.object(["next": .null])])
        XCTAssertNil(defaults.data(forKey: "panel.pendingAlarmSnapshot"))
    }

    @MainActor
    func testBridgeRejectsUnsupportedMethodAndUnsafeBrowserURL() async throws {
        let session = try makeSession()
        defer { session.stop() }
        for raw in [#"{"channel":"control-center-native","id":"request-test","method":"unknown"}"#,
                    #"{"channel":"control-center-native","id":"request-test","method":"openBrowser","params":{"url":"javascript:alert(1)"}}"#] {
            let response = await session.handle(try XCTUnwrap(NativeRequest.parse(raw)), in: WKWebView())
            XCTAssertFalse(response.ok)
        }
        XCTAssertNil(session.browser)
    }
}
