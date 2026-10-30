import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

private actor ClimateTransport: PanelTransport {
    let data: Data
    let status: Int
    private(set) var requests: [URLRequest] = []
    init(_ name: String, status: Int = 200) throws {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/climate"))
        data = try Data(contentsOf: url); self.status = status
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
private func climateAPI(_ transport: ClimateTransport) -> ClimateAPI {
    ClimateAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport))
}

@Test(arguments: ["off", "off-remembered", "cool", "heat", "heat-cool"])
func climateModeFixtures(_ name: String) async throws {
    let transport = try ClimateTransport(name)
    let state = try await climateAPI(transport).get()
    switch name {
    case "off": #expect(state.setpoints == .off(target: nil, low: nil, high: nil)); #expect(state.mode == .off)
    case "off-remembered": #expect(state.setpoints == .off(target: 71.5, low: 68.5, high: 74.5))
    case "cool": #expect(state.setpoints == .single(70)); #expect(state.action == .cooling); #expect(state.ambient == 72.5)
    case "heat": #expect(state.setpoints == .single(73)); #expect(state.action == .heating)
    default: #expect(state.setpoints == .range(low: 68, high: 74)); #expect(state.mode == .heatCool)
    }
    let request = try #require(await transport.requests.first)
    #expect(request.url?.path == "/trpc/climate.get")
    #expect(request.httpMethod == "GET"); #expect(request.httpBody == nil)
}

@Test func climateMutationBodies() async throws {
    let transport = try ClimateTransport("cool")
    let api = climateAPI(transport)
    for mode in ClimateAPIMode.allCases { _ = try await api.setMode(mode) }
    _ = try await api.setTarget(67)
    _ = try await api.setTarget(77)
    _ = try await api.setRange(low: 67, high: 77)
    let requests = await transport.requests
    #expect(requests.count == 7)
    for (request, mode) in zip(requests, ClimateAPIMode.allCases) {
        #expect(request.url?.path == "/trpc/climate.setMode")
        #expect(try JSONDecoder().decode(String.self, from: #require(request.httpBody)) == mode.rawValue)
    }
    for (request, target) in zip(requests.dropFirst(4), [67, 77]) {
        #expect(request.url?.path == "/trpc/climate.setTarget")
        #expect(try JSONDecoder().decode(Int.self, from: #require(request.httpBody)) == target)
    }
    #expect(requests.last?.url?.path == "/trpc/climate.setRange")
    #expect(try JSONDecoder().decode([String: Int].self, from: #require(requests.last?.httpBody)) == ["low": 67, "high": 77])
    for request in requests {
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }
}

@Test func climateServerValidationIsPreserved() async throws {
    let transport = try ClimateTransport("bad-range", status: 400)
    await #expect(throws: PanelAPIError.server(code: "BAD_REQUEST", message: "low must be at least 2°F below high", httpStatus: 400)) {
        try await climateAPI(transport).setRange(low: 76, high: 77)
    }
    #expect(await transport.requests.count == 1)
}

@Test func climateRequiresDiscriminatedSetpoints() throws {
    for json in [##"{"mode":"cool","ambient":72,"action":"Idle"}"##,
                 ##"{"mode":"heat_cool","target":70,"ambient":72,"action":"Idle"}"##,
                 ##"{"mode":"off","ambient":72,"action":"Idle"}"##] {
        #expect(throws: (any Error).self) { try JSONDecoder().decode(ClimateAPIState.self, from: Data(json.utf8)) }
    }
}
