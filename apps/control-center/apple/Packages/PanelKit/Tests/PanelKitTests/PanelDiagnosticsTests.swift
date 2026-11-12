import Foundation
import Testing

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

@Test func commandRingCapsAt500AndPreservesCompletionOrder() {
    let log = PanelCommandLog()
    for i in 0..<525 { log.record(control: "command.\(i)", status: 200, latencyMs: i) }
    #expect(log.snapshot().map(\.control) == (25..<525).map { "command.\($0)" })
}

@Test func eventLogBoundsHistoryAndNeverStoresArbitraryText() throws {
    let log = PanelEventLog()
    log.record(category: "network", action: "GET.lights", outcome: "slow", status: 200, durationMs: 1200)
    log.record(category: "Authorization: secret", action: "person@example.com", outcome: "bad value")
    for i in 0..<501 { log.record(category: "navigation", action: "app.\(i).open") }
    let entries = log.snapshot()
    #expect(entries.count == 500)
    #expect(entries.first?.action == "app.1.open")
    #expect(entries.last?.action == "app.500.open")
    let batch = PanelEventBatch(deviceId: UUID().uuidString, deviceLabel: "Kitchen", entries: Array(entries.suffix(2)))
    let body = String(decoding: try JSONEncoder().encode(batch), as: UTF8.self)
    #expect(body.contains("deviceId"))
    #expect(!body.contains("Authorization"))
    #expect(!body.contains("person@example.com"))
}

@Test func unreadableLocalEventHistoryIsVisibleAsStorageFailure() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent("events.json")
    try Data("invalid JSON".utf8).write(to: file)
    let log = PanelEventLog(fileURL: file)
    #expect(!log.storageAvailable)
    #expect(log.snapshot().isEmpty)
}

@Test func networkEventsIncludeStatusOutcomeAndDurationWithoutResourceIdentifiers() async throws {
    let events = PanelEventLog()
    let client = PanelAPIClient(
        configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example")!),
        transport: DiagnosticsTransport(status: 503), commandLog: PanelCommandLog(), eventLog: events)
    do {
        _ = try await client.get("lights/private-room-id", as: DiagnosticsResult.self)
        Issue.record("Expected HTTP failure")
    } catch {}
    let event = try #require(events.snapshot().last)
    #expect(event.action == "GET.lights")
    #expect(event.status == 503)
    #expect(event.outcome == "http_error")
    #expect(event.durationMs != nil)
}

@Test func automaticEventUploadUsesServerWireShapeWithoutLoggingItself() async throws {
    let events = PanelEventLog()
    events.record(category: "navigation", action: "app.settings.open")
    let transport = DiagnosticsTransport(status: 200)
    let commands = PanelCommandLog()
    let client = PanelAPIClient(
        configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example")!),
        transport: transport, commandLog: commands, eventLog: events)
    let batch = PanelEventBatch(deviceId: UUID().uuidString, deviceLabel: "Kitchen", entries: events.snapshot())
    _ = try await client.post("diagnostics/events", input: batch, as: DiagnosticsResult.self)
    let request = try #require(await transport.requests.first)
    let body = try #require(request.httpBody)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    let sent = try #require((json["events"] as? [[String: Any]])?.first)
    #expect(json["deviceId"] as? String == batch.deviceId)
    #expect(json["deviceLabel"] as? String == "Kitchen")
    #expect(json["build"] as? String == "dev")
    #expect(json["gitSHA"] as? String == "dev")
    #expect((sent["time"] as? String)?.hasSuffix("Z") == true)
    #expect(sent["durationMs"] == nil)
    #expect(events.snapshot().count == 1)
    #expect(commands.snapshot().isEmpty)
}

@Test func commandLogAndUploadedPayloadCannotContainHeadersSecretsOrPersonalText() throws {
    let log = PanelCommandLog()
    let input = Data(
        #"{"CF-Access-Client-Id":"synthetic-id","CF-Access-Client-Secret":"synthetic-secret","Authorization":"Bearer private-token","id":"person@example.com","label":"Morning alarm","mode":"synthetic-secret","on":true}"#
            .utf8)
    log.record(control: "alarms.save", input: input, status: 503, error: "synthetic-secret", latencyMs: 12)
    let snapshot = PanelDiagnosticsSnapshot(
        source: "live", backendURL: "https://panel.example", build: "1", gitSHA: "dev", backend: "reachable",
        latencyMs: 12, homeAssistant: "unavailable")
    let data = try JSONEncoder().encode(PanelDiagnosticsSubmission(snapshot: snapshot, commands: log.snapshot()))
    let json = String(decoding: data, as: UTF8.self)
    for privateValue in [
        "CF-Access", "Authorization", "synthetic-id", "synthetic-secret", "private-token", "person@example.com",
        "Morning alarm",
    ] {
        #expect(!json.contains(privateValue))
    }
    #expect(log.snapshot().first?.payload["id"] == "<redacted>")
    #expect(log.snapshot().first?.error == "request failed")
}

private actor DiagnosticsTransport: PanelTransport {
    let status: Int
    private(set) var requests: [URLRequest] = []
    init(status: Int) { self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (
            Data(#"{"ok":true}"#.utf8),
            HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        )
    }
}
private struct DiagnosticsResult: Decodable, Sendable { let ok: Bool }

@Test func apiChokePointRecordsSuccessHTTPFailureAndUnconfiguredDrop() async throws {
    let log = PanelCommandLog()
    let config = PanelConfiguration(baseURL: URL(string: "https://panel.example")!)
    let success = PanelAPIClient(configuration: config, transport: DiagnosticsTransport(status: 200), commandLog: log)
    _ = try await success.post("controls", input: ["on": true], as: DiagnosticsResult.self)
    #expect(log.snapshot().last?.status == 200)
    let failed = PanelAPIClient(configuration: config, transport: DiagnosticsTransport(status: 503), commandLog: log)
    do {
        _ = try await failed.post("controls", input: ["on": false], as: DiagnosticsResult.self)
        Issue.record("Expected HTTP failure")
    } catch {}
    #expect(log.snapshot().last?.status == 503)
    #expect(log.snapshot().last?.error == "request failed")
    let missing = PanelAPIClient(configuration: nil, commandLog: log)
    do {
        _ = try await missing.post("controls", input: ["on": true], as: DiagnosticsResult.self)
        Issue.record("Expected missing configuration")
    } catch {}
    #expect(log.snapshot().count == 3)
    #expect(log.snapshot().last?.error == "request failed")
}

@Test func submissionHTTPBodyExcludesAccessCredentials() async throws {
    let log = PanelCommandLog()
    log.record(control: "controls.toggle", input: Data(#"{"on":true,"id":"synthetic-secret"}"#.utf8), status: 200)
    let transport = DiagnosticsTransport(status: 200)
    let config = PanelConfiguration(
        baseURL: URL(string: "https://panel.example")!)
    let client = PanelAPIClient(configuration: config, transport: transport, commandLog: log)
    let snapshot = PanelDiagnosticsSnapshot(
        source: "fixture", backendURL: "https://panel.example", build: "1", gitSHA: "dev", backend: "reachable",
        latencyMs: 1, homeAssistant: "connected")
    _ = try await client.post(
        "diagnostics", input: PanelDiagnosticsSubmission(snapshot: snapshot, commands: log.snapshot()),
        as: DiagnosticsResult.self)
    let request = try #require(await transport.requests.first)
    #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == nil)
    let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
    for value in ["CF-Access", "synthetic-id", "synthetic-secret", "Authorization"] { #expect(!body.contains(value)) }
    #expect(log.snapshot().count == 1, "Sending diagnostics must not recursively log itself")
}
