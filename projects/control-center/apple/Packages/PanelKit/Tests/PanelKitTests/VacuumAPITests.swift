import Foundation
import Testing

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

private actor VacuumTransport: PanelTransport {
    let response: String
    let status: Int
    private(set) var requests: [URLRequest] = []
    init(_ response: String, status: Int = 200) {
        self.response = response
        self.status = status
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (
            Data(response.utf8),
            HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        )
    }
}

private func vacuumAPI(_ transport: VacuumTransport) -> VacuumAPI {
    VacuumAPI(
        client: PanelAPIClient(
            configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!),
            transport: transport))
}

@Test func vacuumSnapshotAndCommandsUseTheSharedTransport() async throws {
    let read = VacuumTransport(#"{"status":"docked","battery":85,"rooms":[]}"#)
    let snapshot = try await vacuumAPI(read).list()
    #expect(snapshot.status == "docked")
    #expect(snapshot.battery == 85)
    #expect(snapshot.rooms.isEmpty)
    #expect(await read.requests.first?.url?.path == "/api/v1/vacuum")
    for action in [VacuumAPI.Action.start, .pause, .stop, .dock, .room] {
        let write = VacuumTransport(#"{"ok":true}"#)
        try await vacuumAPI(write).command(action, room: action == .room ? "living-room" : nil)
        let requests = await write.requests
        #expect(requests.count == 1)
        let request = try #require(requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/v1/vacuum")
        let body = try #require(request.httpBody)
        let input = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(input["action"] == action.rawValue)
        #expect(input["room"] == (action == .room ? "living-room" : nil))
    }
}

@Test func vacuumAmbiguousFailureIsNeverRetried() async throws {
    let transport = VacuumTransport("{}", status: 503)
    await #expect(throws: PanelAPIError.self) {
        try await vacuumAPI(transport).command(.start)
    }
    #expect(await transport.requests.count == 1)
}
