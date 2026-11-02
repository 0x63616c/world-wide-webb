import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

@Test func commandRingCapsAt50AndPreservesCompletionOrder() {
    let log = PanelCommandLog()
    for i in 0..<75 { log.record(control: "command.\(i)", status: 200, latencyMs: i) }
    #expect(log.snapshot().map(\.control) == (25..<75).map { "command.\($0)" })
}

@Test func commandLogAndUploadedPayloadCannotContainHeadersSecretsOrPersonalText() throws {
    let log = PanelCommandLog()
    let input = Data(#"{"CF-Access-Client-Id":"synthetic-id","CF-Access-Client-Secret":"synthetic-secret","Authorization":"Bearer private-token","id":"person@example.com","label":"Morning alarm","mode":"synthetic-secret","on":true}"#.utf8)
    log.record(control: "alarms.save", input: input, status: 503, error: "synthetic-secret", latencyMs: 12)
    let snapshot = PanelDiagnosticsSnapshot(source: "live", backendURL: "https://panel.example", build: "1", gitSHA: "dev", backend: "reachable", latencyMs: 12, homeAssistant: "unavailable")
    let data = try JSONEncoder().encode(PanelDiagnosticsSubmission(snapshot: snapshot, commands: log.snapshot()))
    let json = String(decoding: data, as: UTF8.self)
    for privateValue in ["CF-Access", "Authorization", "synthetic-id", "synthetic-secret", "private-token", "person@example.com", "Morning alarm"] {
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
        return (Data(#"{"result":{"data":{"ok":true}}}"#.utf8),
         HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
private struct DiagnosticsResult: Decodable, Sendable { let ok: Bool }

@Test func apiChokePointRecordsSuccessHTTPFailureAndUnconfiguredDrop() async throws {
    let log = PanelCommandLog()
    let config = PanelConfiguration(baseURL: URL(string: "https://panel.example")!)
    let success = PanelAPIClient(configuration: config, transport: DiagnosticsTransport(status: 200), commandLog: log)
    _ = try await success.mutation("controls.toggle", input: ["on": true], as: DiagnosticsResult.self)
    #expect(log.snapshot().last?.status == 200)
    let failed = PanelAPIClient(configuration: config, transport: DiagnosticsTransport(status: 503), commandLog: log)
    do { _ = try await failed.mutation("controls.toggle", input: ["on": false], as: DiagnosticsResult.self); Issue.record("Expected HTTP failure") } catch {}
    #expect(log.snapshot().last?.status == 503)
    #expect(log.snapshot().last?.error == "request failed")
    let missing = PanelAPIClient(configuration: nil, commandLog: log)
    do { _ = try await missing.mutation("controls.toggle", input: ["on": true], as: DiagnosticsResult.self); Issue.record("Expected missing configuration") } catch {}
    #expect(log.snapshot().count == 3)
    #expect(log.snapshot().last?.error == "request failed")
}

@Test func submissionHTTPBodyExcludesAccessCredentials() async throws {
    let log = PanelCommandLog()
    log.record(control: "controls.toggle", input: Data(#"{"on":true,"id":"synthetic-secret"}"#.utf8), status: 200)
    let transport = DiagnosticsTransport(status: 200)
    let config = PanelConfiguration(baseURL: URL(string: "https://panel.example")!,
        accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret")
    let client = PanelAPIClient(configuration: config, transport: transport, commandLog: log)
    let snapshot = PanelDiagnosticsSnapshot(source: "fixture", backendURL: "https://panel.example", build: "1", gitSHA: "dev", backend: "reachable", latencyMs: 1, homeAssistant: "connected")
    _ = try await client.mutation("diagnostics.submit", input: PanelDiagnosticsSubmission(snapshot: snapshot, commands: log.snapshot()), as: DiagnosticsResult.self)
    let request = try #require(await transport.requests.first)
    #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "synthetic-secret")
    let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
    for value in ["CF-Access", "synthetic-id", "synthetic-secret", "Authorization"] { #expect(!body.contains(value)) }
    #expect(log.snapshot().count == 1, "Sending diagnostics must not recursively log itself")
}
