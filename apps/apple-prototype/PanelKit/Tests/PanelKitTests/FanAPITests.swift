import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

private actor FanTransport: PanelTransport {
    let data: Data
    private(set) var requests: [URLRequest] = []
    init(_ data: Data) { self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

@Test func fanFixturesDecodeAndQuery() async throws {
    for (name, on, sub, pending) in [("on", true, "On", false), ("auto", false, "Auto", false),
                                     ("off", false, "Off", false), ("pending", true, "On", true),
                                     ("unknown", false, "", false)] {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/fan"))
        let transport = FanTransport(try Data(contentsOf: url))
        let api = FanAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport))
        let state = try await api.list()
        #expect(state.fan.on == on)
        #expect(state.fan.sub == sub)
        #expect(state.fan.pending == pending)
        let request = try #require(await transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/trpc/controls.list")
        #expect(request.httpBody == nil)
    }
}

@Test func fanToggleSendsExactInputInBothDirections() async throws {
    let url = try #require(Bundle.module.url(forResource: "pending", withExtension: "json", subdirectory: "Fixtures/fan"))
    for on in [true, false] {
        let transport = FanTransport(try Data(contentsOf: url))
        let api = FanAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport))
        let state = try await api.toggle(on: on)
        #expect(state.fan.pending)
        let request = try #require(await transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/trpc/controls.toggle")
        let body = try #require(request.httpBody)
        let object = try #require(JSONSerialization.jsonObject(with: body) as? NSDictionary)
        #expect(object == ["key": "fan", "on": on] as NSDictionary)
    }
}
