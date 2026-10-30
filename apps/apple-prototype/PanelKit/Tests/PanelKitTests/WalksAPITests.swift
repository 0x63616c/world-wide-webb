import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

/// Synthetic recordings of the WWW-27 contract; envelopes match plain tRPC v11 HTTP.
private func walkFixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/walks"))
    return try Data(contentsOf: url)
}

private actor WalksTransport: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    init(_ data: Data, status: Int = 200) { self.data = data; self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

private func walksAPI(_ transport: WalksTransport) -> WalksAPI {
    WalksAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!),
                                   transport: transport))
}

@Test func walksDecodeRecordingsFromBackendPR804() async throws {
    // Copied verbatim from WWW-27 0ff97165, docs/contracts/walks/fixtures/*.json.
    for name in ["state", "start", "stop", "delete", "update"] {
        let state = try await walksAPI(WalksTransport(walkFixture("contract-" + name))).state()
        if name == "state" || name == "start" {
            #expect(state.active?.source == .iphone)
            #expect(state.serverTime.timeIntervalSince(state.active!.startedAt) == 5)
        } else {
            #expect(state.active == nil)
        }
    }
    let history = try await walksAPI(WalksTransport(walkFixture("contract-history"))).history()
    #expect(history.walks.count == 1)
    #expect(history.walks.first?.endedAt != nil)
}

@Test func walksStateDecodesIdleAndAuthoritativeDates() async throws {
    let transport = WalksTransport(try walkFixture("state-active"))
    let state = try await walksAPI(transport).state()
    let walk = try #require(state.active)
    #expect(walk.id == "11111111-1111-4111-8111-111111111111")
    #expect(walk.source == .ipad)
    #expect(walk.endedAt == nil)
    #expect(walk.startedAt == state.serverTime)
    #expect(walk.createdAt == walk.updatedAt)
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "GET")
    #expect(request.url?.path == "/trpc/walks.state")
    #expect(request.url?.query == nil)
    let idle = try await walksAPI(WalksTransport(walkFixture("state-idle"))).state()
    #expect(idle.active == nil)
    #expect(idle.updatedAt == Date(timeIntervalSince1970: 0))
}

@Test func walksHistoryDecodesCompletedRecordsAndSources() async throws {
    let history = try await walksAPI(WalksTransport(walkFixture("history"))).history()
    #expect(history.walks.count == 2)
    #expect(history.walks[0].startedAt > history.walks[1].startedAt)
    #expect(history.walks[0].endedAt?.timeIntervalSince(history.walks[0].startedAt) == 1800)
    let sources = try await walksAPI(WalksTransport(walkFixture("history-sources"))).history()
    #expect(sources.walks.map(\.source) == WalkSource.allCases)
    let empty = try await walksAPI(WalksTransport(walkFixture("history-empty"))).history()
    #expect(empty.walks.isEmpty)
}

@Test func walksHistoryPagingUsesPlainJSONQuery() async throws {
    let transport = WalksTransport(try walkFixture("history"))
    _ = try await walksAPI(transport).history(limit: 500, before: Date(timeIntervalSince1970: 0))
    let request = try #require(await transport.requests.first)
    let components = try #require(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
    let input = try #require(components.queryItems?.first?.value)
    let object = try #require(JSONSerialization.jsonObject(with: Data(input.utf8)) as? [String: Any])
    #expect(request.httpMethod == "GET")
    #expect(request.url?.path == "/trpc/walks.history")
    #expect(object["limit"] as? Int == 500)
    #expect(object["before"] as? String == "1970-01-01T00:00:00.000Z")
}

@Test func walksMutationsUseExactInputsAndStateEnvelopes() async throws {
    let id = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    for procedure in ["start", "stop", "delete", "update"] {
        let transport = WalksTransport(try walkFixture(procedure))
        let api = walksAPI(transport)
        switch procedure {
        case "start": _ = try await api.start(id: id, source: .iphone)
        case "stop": _ = try await api.stop(id: "walk_synthetic_previous")
        case "delete": _ = try await api.delete(id: "walk_synthetic_previous")
        default: _ = try await api.update(id: "walk_synthetic_previous", endedAt: Date(timeIntervalSince1970: 0))
        }
        let request = try #require(await transport.requests.first)
        let body = try #require(request.httpBody)
        let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/trpc/walks.\(procedure)")
        switch procedure {
        case "start": #expect(object == ["id": id.uuidString.lowercased(), "source": "iphone"])
        case "update": #expect(object == ["id": "walk_synthetic_previous", "endedAt": "1970-01-01T00:00:00.000Z"])
        default: #expect(object == ["id": "walk_synthetic_previous"])
        }
    }
}

@Test func walksOptionalTimesEncodeISO8601AndDefaultInputsStayEmpty() async throws {
    let transport = WalksTransport(try walkFixture("start"))
    let api = walksAPI(transport)
    _ = try await api.start(startedAt: Date(timeIntervalSince1970: 0))
    _ = try await api.stop(id: "walk_example", endedAt: Date(timeIntervalSince1970: 1))
    _ = try await api.update(id: "walk_example", startedAt: Date(timeIntervalSince1970: 0), endedAt: Date(timeIntervalSince1970: 1))
    let historyTransport = WalksTransport(try walkFixture("history-empty"))
    _ = try await walksAPI(historyTransport).history()
    let requests = await transport.requests
    let start = try #require(JSONSerialization.jsonObject(with: requests[0].httpBody!) as? [String: String])
    #expect(start == ["source": "unknown", "startedAt": "1970-01-01T00:00:00.000Z"])
    let stop = try #require(JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: String])
    #expect(stop["endedAt"] == "1970-01-01T00:00:01.000Z")
    let update = try #require(JSONSerialization.jsonObject(with: requests[2].httpBody!) as? [String: String])
    #expect(update["startedAt"] == "1970-01-01T00:00:00.000Z")
    #expect(update["endedAt"] == "1970-01-01T00:00:01.000Z")
    let historyRequest = try #require(await historyTransport.requests.first)
    let query = URLComponents(url: historyRequest.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value
    #expect(query == "{}")
}

@Test func walksRejectInvalidInputsBeforeNetworking() async throws {
    let transport = WalksTransport(try walkFixture("state-idle"))
    let api = walksAPI(transport)
    for limit in [0, 501] {
        await #expect(throws: PanelAPIError.self) { try await api.history(limit: limit) }
    }
    await #expect(throws: PanelAPIError.self) { try await api.stop(id: "") }
    await #expect(throws: PanelAPIError.self) { try await api.delete(id: String(repeating: "a", count: 129)) }
    await #expect(throws: PanelAPIError.self) {
        try await api.update(id: "walk_example", startedAt: Date(timeIntervalSince1970: 1), endedAt: Date(timeIntervalSince1970: 0))
    }
    #expect(await transport.requests.isEmpty)
}

@Test func walksDecodeFractionalAndWholeSecondsButRejectBadDates() async throws {
    let json = String(decoding: try walkFixture("state-active"), as: UTF8.self)
    let wholeSeconds = json.replacingOccurrences(of: ".000Z", with: "Z")
    let whole = try await walksAPI(WalksTransport(Data(wholeSeconds.utf8))).state()
    let fractional = try await walksAPI(WalksTransport(Data(json.utf8))).state()
    #expect(whole == fractional)
    let invalid = json.replacingOccurrences(of: "2026-10-01T12:00:00.000Z", with: "not-a-date")
    await #expect(throws: PanelAPIError.self) { try await walksAPI(WalksTransport(Data(invalid.utf8))).state() }
}

@Test func walksPreserveTypedServiceErrors() async throws {
    do {
        _ = try await walksAPI(WalksTransport(walkFixture("unavailable"), status: 503)).state()
        Issue.record("Expected service unavailable")
    } catch let error as PanelAPIError {
        #expect(error.isServiceUnavailable)
    }
}
