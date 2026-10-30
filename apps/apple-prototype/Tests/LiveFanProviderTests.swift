import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

private actor FanProviderTransport: PanelTransport {
    var responses: [String]
    private(set) var requests: [URLRequest] = []
    init(_ responses: [String]) { self.responses = responses }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !responses.isEmpty else { throw URLError(.notConnectedToInternet) }
        return (Data(responses.removeFirst().utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

@MainActor final class LiveFanProviderTests: XCTestCase {
    private func response(_ on: Bool, _ label: String, pending: Bool = false) -> String {
        "{\"result\":{\"data\":{\"fan\":{\"on\":\(on),\"sub\":\"\(label)\",\"pending\":\(pending)}}}}"
    }
    private func provider(_ transport: FanProviderTransport) -> LiveFanProvider {
        LiveFanProvider(api: FanAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport)))
    }
    func testUnloadedDoesNotInventStateOrToggle() async {
        let transport = FanProviderTransport([])
        let live = provider(transport)
        XCTAssertNil(live.fanOn)
        XCTAssertNil(live.fanLabel)
        XCTAssertEqual(live.availability, .loading)
        await live.toggle()
        let count = await transport.requests.count
        XCTAssertEqual(count, 0)
    }
    func testAutoAndACOffMatchWebWithoutChangingClimateFields() async {
        let live = provider(FanProviderTransport([response(false, "Auto"), response(false, "Off"), response(true, "On")]))
        for (label, on) in [("Auto", false), ("Off", false), ("On", true)] {
            await live.refresh()
            XCTAssertEqual(live.fanLabel, label)
            XCTAssertEqual(live.fanOn, on)
            var climate = ClimateState()
            climate.mode = .heat; climate.target = 75
            let mapped = live.applying(to: climate)
            XCTAssertEqual(mapped.mode, .heat)
            XCTAssertEqual(mapped.target, 75)
            XCTAssertEqual(mapped.fanOn, on)
        }
    }
    func testToggleUsesReturnedPendingAndFailurePreservesState() async throws {
        let transport = FanProviderTransport([response(false, "Auto"), response(true, "On", pending: true), response(false, "Off")])
        let live = provider(transport)
        await live.refresh()
        await live.toggle()
        XCTAssertEqual(live.fanOn, true)
        XCTAssertEqual(live.pending, ["fan"])
        await live.toggle()
        XCTAssertEqual(live.fanOn, false)
        XCTAssertTrue(live.pending.isEmpty)
        let requests = await transport.requests
        for (index, on) in [(1, true), (2, false)] {
            let body = try XCTUnwrap(requests[index].httpBody)
            XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? NSDictionary, ["key": "fan", "on": on] as NSDictionary)
        }
        await live.toggle()
        XCTAssertEqual(live.fanOn, false)
        XCTAssertEqual(live.fanLabel, "Off")
        XCTAssertTrue(live.pending.isEmpty)
        guard case .unavailable = live.availability else { return XCTFail("Expected unavailable") }
    }
    func testMockOffLabelAndToggle() async {
        var climate = ClimateState(); climate.mode = .off
        let mock = MockFanProvider(climate: climate)
        XCTAssertEqual(mock.fanLabel, "Off")
        await mock.toggle()
        XCTAssertEqual(mock.fanOn, true)
    }
}
