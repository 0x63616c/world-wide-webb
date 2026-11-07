import Foundation
import Testing

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

private actor AlarmTransport: PanelTransport {
    let data: Data
    private(set) var requests: [URLRequest] = []
    init(_ name: String) throws {
        data = try Data(
            contentsOf: #require(
                Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/alarms")))
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

private func alarmAPI(_ transport: AlarmTransport) -> AlarmsAPI {
    AlarmsAPI(
        client: PanelAPIClient(
            configuration: PanelConfiguration(baseURL: URL(string: "https://alarms.example.invalid")!),
            transport: transport))
}

@Test func alarmSnapshotsMatchServerContract() async throws {
    for name in ["scheduled", "ringing", "snoozed", "reringing", "stopped", "empty"] {
        let transport = try AlarmTransport(name)
        let value = try await alarmAPI(transport).list()
        #expect(value.defaults.snoozeMinutes == 9)
        if name == "empty" {
            #expect(value.alarms.isEmpty)
            #expect(value.next == nil)
        } else {
            #expect(value.alarms[0].id == "alm_example")
            #expect(value.alarms[0].snoozeMinutes == nil)
            #expect(value.alarms[0].repeatDays == [1, 2, 3, 4, 5])
        }
        let request = try #require(await transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/api/v1/alarms")
        #expect(request.httpBody == nil)
    }
}

@Test func alarmMutationsUseExactPathsAndVersionedOccurrences() async throws {
    let transport = try AlarmTransport("ack")
    let api = alarmAPI(transport)
    let alarm = AlarmInput(
        label: "Test", time: "07:15", timeZone: "Etc/UTC", repeatDays: [1, 3], snoozeMinutes: 12,
        lightTarget: "scene.test_wake")
    try await api.create(alarm)
    try await api.update(id: "alm_example", alarm: alarm)
    try await api.setEnabled(id: "alm_example", enabled: false)
    try await api.delete(id: "alm_example")
    try await api.snooze(id: "alr_example", version: 2)
    try await api.stop(id: "alr_example", version: 4)
    let requests = await transport.requests
    #expect(
        requests.map { $0.url!.lastPathComponent } == [
            "alarms", "alm_example", "alm_example", "alm_example", "action", "action",
        ])
    #expect(requests.map { $0.httpMethod! } == ["POST", "PATCH", "PATCH", "DELETE", "POST", "POST"])
    let bodies = try requests.map {
        try JSONSerialization.jsonObject(with: $0.httpBody ?? Data("{}".utf8)) as! NSDictionary
    }
    #expect(bodies[0]["timeZone"] as? String == "Etc/UTC")
    #expect(bodies[1] == bodies[0])
    #expect(bodies[2] == ["enabled": false] as NSDictionary)
    #expect(requests[3].httpBody == nil)
    #expect(bodies[4] == ["id": "alr_example", "version": 2, "action": "snooze"] as NSDictionary)
    #expect(bodies[5] == ["id": "alr_example", "version": 4, "action": "stop"] as NSDictionary)
}

@Test func alarmConflictIsNotRetried() async throws {
    let transport = try AlarmTransport("conflict")
    await #expect(throws: PanelAPIError.self) { try await alarmAPI(transport).snooze(id: "alr_example", version: 0) }
    #expect(await transport.requests.count == 1)
}

@Test func cachedRingsExpireAndSnoozesDoNotRingEarly() async throws {
    let ringing = try await alarmAPI(AlarmTransport("ringing")).list().active[0]
    #expect(ringing.isRinging(at: AlarmDate.parse("2099-01-01T07:00:01Z")!))
    #expect(!ringing.isRinging(at: AlarmDate.parse("2099-01-01T07:30:00Z")!))
    let snoozed = try await alarmAPI(AlarmTransport("snoozed")).list().active[0]
    #expect(!snoozed.isRinging(at: AlarmDate.parse("2099-01-01T07:10:00Z")!))
}
