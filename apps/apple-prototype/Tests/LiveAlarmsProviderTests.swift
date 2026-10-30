import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

private actor AlarmProviderTransport: PanelTransport {
    var fixtures: [String]
    private(set) var requests: [URLRequest] = []
    init(_ fixtures: [String]) { self.fixtures = fixtures }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !fixtures.isEmpty else { throw URLError(.notConnectedToInternet) }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("PanelKit/Tests/PanelKitTests/Fixtures/alarms/\(fixtures.removeFirst()).json")
        return (try Data(contentsOf: url), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

@MainActor final class LiveAlarmsProviderTests: XCTestCase {
    private let now = AlarmDate.parse("2099-01-01T07:00:01Z")!
    private func provider(_ transport: AlarmProviderTransport) -> LiveAlarmsProvider {
        LiveAlarmsProvider(api: AlarmsAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://alarms.example.invalid")!), transport: transport)))
    }

    func testEmptyIsLiveButAbsentEndpointFallsBack() async {
        let live = provider(AlarmProviderTransport(["empty"]))
        XCTAssertEqual(live.availability, .loading)
        XCTAssertTrue(live.alarms.isEmpty)
        await live.refresh()
        XCTAssertEqual(live.availability, .live)
        XCTAssertNil(live.upcoming(at: now))
        await live.refresh()
        guard case .unavailable = live.availability else { return XCTFail("Must fall back") }
    }

    func testUsesServerNextRatherThanRecomputingFromDefinition() async throws {
        let live = provider(AlarmProviderTransport(["scheduled"]))
        await live.refresh()
        let next = try XCTUnwrap(live.upcoming(at: now))
        XCTAssertEqual(next.due, AlarmDate.parse("2099-01-02T07:00:00Z"))
        XCTAssertEqual(next.alarm.label, "Morning")
        XCTAssertEqual(live.alarms[0].snoozeMinutes, "")
    }

    func testRingSnoozeReringStopAndStableOccurrenceIdentity() async throws {
        let transport = AlarmProviderTransport(["ringing", "ack", "snoozed", "reringing", "ack", "stopped"])
        let live = provider(transport)
        await live.refresh()
        let first = try XCTUnwrap(live.upcoming(at: now))
        XCTAssertTrue(first.ringing)
        XCTAssertEqual(first.version, 0)
        XCTAssertNotEqual(first.alarm.id, live.alarms[0].id)
        try await live.act(first.alarm.id, version: 0, snooze: true, now: now)
        let snoozed = try XCTUnwrap(live.upcoming(at: now))
        XCTAssertTrue(snoozed.snoozed)
        XCTAssertFalse(snoozed.ringing)
        XCTAssertEqual(snoozed.version, 1)
        await live.refresh()
        let later = AlarmDate.parse("2099-01-01T07:09:02Z")!
        let again = try XCTUnwrap(live.upcoming(at: later))
        XCTAssertTrue(again.ringing)
        XCTAssertEqual(again.alarm.id, first.alarm.id)
        XCTAssertEqual(again.version, 2)
        do { try await live.act(first.alarm.id, version: 0, snooze: false, now: later); XCTFail("Stale version") } catch {}
        try await live.act(again.alarm.id, version: 2, snooze: false, now: later)
        XCTAssertFalse(try XCTUnwrap(live.upcoming(at: later)).ringing)
        let writes = await transport.requests.filter { $0.httpMethod == "POST" }
        XCTAssertEqual(writes.map { $0.url!.lastPathComponent }, ["alarms.snooze", "alarms.stop"])
        let body = try XCTUnwrap(writes[1].httpBody)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? NSDictionary, ["id": "alr_example", "version": 2] as NSDictionary)
    }

    func testConflictRefreshesStateWithoutRetryingOrOptimisticSuccess() async throws {
        let transport = AlarmProviderTransport(["ringing", "conflict", "snoozed"])
        let live = provider(transport)
        await live.refresh()
        let ring = try XCTUnwrap(live.upcoming(at: now))
        do { try await live.act(ring.alarm.id, version: 0, snooze: true, now: now); XCTFail("Conflict") } catch {}
        XCTAssertTrue(try XCTUnwrap(live.upcoming(at: now)).snoozed)
        XCTAssertNotNil(live.errorMessage)
        XCTAssertFalse(live.pending)
        let writes = await transport.requests.filter { $0.httpMethod == "POST" }
        XCTAssertEqual(writes.count, 1)
    }

    func testCreateEditEnableDeleteUseBackendIDsAndDefaults() async throws {
        let transport = AlarmProviderTransport(["scheduled", "ack", "scheduled", "ack", "scheduled", "ack", "scheduled", "ack", "empty"])
        let live = provider(transport)
        await live.refresh()
        var alarm = live.newAlarm
        alarm.label = "Test alarm"; alarm.timeZone = "Etc/UTC"
        try await live.save(alarm)
        var edit = live.alarms[0]; edit.label = "Updated"
        let id = edit.id
        try await live.save(edit)
        XCTAssertEqual(live.alarms[0].id, id)
        try await live.setEnabled(id, enabled: false)
        try await live.delete(id)
        XCTAssertTrue(live.alarms.isEmpty)
        let writes = await transport.requests.filter { $0.httpMethod == "POST" }
        XCTAssertEqual(writes.map { $0.url!.lastPathComponent }, ["alarms.create", "alarms.update", "alarms.setEnabled", "alarms.delete"])
        let input = try JSONDecoder().decode(AlarmInput.self, from: XCTUnwrap(writes[0].httpBody))
        XCTAssertNil(input.snoozeMinutes)
        XCTAssertNil(input.lightTarget)
        let update = try JSONSerialization.jsonObject(with: XCTUnwrap(writes[1].httpBody)) as? NSDictionary
        XCTAssertEqual(update?["id"] as? String, "alm_example")
    }

    func testCachedRingExpiresAndSuccessfulWriteIsNotRetriedAfterReadFailure() async throws {
        let live = provider(AlarmProviderTransport(["ringing", "ack"]))
        await live.refresh()
        XCTAssertFalse(try XCTUnwrap(live.upcoming(at: AlarmDate.parse("2099-01-01T07:30:00Z")!)).ringing)
        try await live.save(live.newAlarm)
        guard case .unavailable = live.availability else { return XCTFail("Read failed") }
    }
}
