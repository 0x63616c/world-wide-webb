import Foundation
import XCTest

@testable import Panel

final class AlarmSnapshotTests: XCTestCase {
    func testNextPresentPreservesServerFieldsAndIgnoresUnrelatedFields() throws {
        let data = Data(
            #"{"next":{"id":"alarm_test","label":"Morning","at":"2099-01-02T08:30:00.123Z"},"alarms":[]}"#.utf8)
        let next = try XCTUnwrap(JSONDecoder().decode(AlarmSnapshot.self, from: data).next)
        XCTAssertEqual(next.id, "alarm_test")
        XCTAssertEqual(next.label, "Morning")
        XCTAssertEqual(next.at, "2099-01-02T08:30:00.123Z")
    }

    func testNullOrMissingNextClearsActivityLikeExpo() throws {
        for json in [#"{"next":null}"#, "{}"] {
            XCTAssertNil(try JSONDecoder().decode(AlarmSnapshot.self, from: Data(json.utf8)).next)
        }
    }

    func testMalformedSnapshotThrows() {
        for json in [
            "not json", "null", "[]", #"{"next":true}"#, #"{"next":{}}"#,
            #"{"next":{"id":7,"label":"Alarm","at":"2099-01-02T08:30:00Z"}}"#,
            #"{"next":{"id":"alarm_test","label":"Alarm","at":null}}"#,
        ] {
            XCTAssertThrowsError(try JSONDecoder().decode(AlarmSnapshot.self, from: Data(json.utf8)), json)
        }
    }
}

/// Exercises the real JSON contract without starting Live Activities, touching
/// Keychain, or making network requests in unit tests.
actor AlarmCoordinatorSpy: PanelAlarmCoordinating {
    private(set) var snapshots: [String] = []
    private(set) var calls: [String] = []
    private(set) var configuredURL: String?
    private(set) var configuredAccess: [String] = []
    var failSync = false
    var failConfiguration = false

    func setFailures(sync: Bool = false, configuration: Bool = false) {
        failSync = sync
        failConfiguration = configuration
    }

    func configure(url: String, token: String, clientID: String, clientSecret: String) async throws {
        await Task.yield()
        if failConfiguration { throw PanelAlarmError.invalidURL }
        configuredURL = url
        configuredAccess = [token, clientID, clientSecret]
        calls.append("configure")
    }

    func refresh() async throws { calls.append("refresh") }

    func sync(json: String) async throws {
        if failSync { throw PanelAlarmError.server(503) }
        _ = try JSONDecoder().decode(AlarmSnapshot.self, from: Data(json.utf8))
        await Task.yield()
        snapshots.append(json)
    }
}

final class PanelAlarmTests: XCTestCase {
    @MainActor
    func testRefreshWaitsForConfigurationAndRunsOnEachForeground() async {
        let coordinator = AlarmCoordinatorSpy()
        let alarms = PanelAlarms(coordinator: coordinator)
        alarms.configure(
            serverURL: URL(string: "https://example.test")!, token: "test-token",
            cfID: "test-id", cfSecret: "test-secret")
        await alarms.refresh()
        await alarms.refresh()
        let calls = await coordinator.calls
        let url = await coordinator.configuredURL
        let access = await coordinator.configuredAccess
        XCTAssertEqual(calls, ["configure", "refresh", "refresh"])
        XCTAssertEqual(url, "https://example.test")
        XCTAssertEqual(access, ["test-token", "test-id", "test-secret"])
    }

    @MainActor
    func testMissingTokenSkipsTransportConfiguration() async throws {
        let coordinator = AlarmCoordinatorSpy()
        let alarms = PanelAlarms(coordinator: coordinator)
        alarms.configure(serverURL: URL(string: "https://example.test")!, token: "", cfID: "", cfSecret: "")
        await alarms.refresh()
        try await alarms.sync(next: nil)
        let calls = await coordinator.calls
        let snapshots = await coordinator.snapshots
        XCTAssertTrue(calls.isEmpty)
        XCTAssertEqual(snapshots, ["{\"next\":null}"])
    }

    @MainActor
    func testFailedConfigurationDoesNotRefreshOldCredentials() async {
        let coordinator = AlarmCoordinatorSpy()
        await coordinator.setFailures(configuration: true)
        let alarms = PanelAlarms(coordinator: coordinator)
        alarms.configure(serverURL: URL(string: "http://example.test")!, token: "test-token", cfID: "", cfSecret: "")
        await alarms.refresh()
        let calls = await coordinator.calls
        XCTAssertTrue(calls.isEmpty)
    }

}
