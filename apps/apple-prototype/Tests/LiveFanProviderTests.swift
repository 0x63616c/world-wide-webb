import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

private actor FanProviderTransport: PanelTransport {
    var responses: [String]
    private(set) var requests: [URLRequest] = []
    private let blockedRequest: Int?
    private var continuation: CheckedContinuation<Void, Never>?
    init(_ responses: [String], blockedRequest: Int? = nil) {
        self.responses = responses
        self.blockedRequest = blockedRequest
    }
    func release() { continuation?.resume(); continuation = nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !responses.isEmpty else { throw URLError(.notConnectedToInternet) }
        let response = responses.removeFirst()
        if requests.count == blockedRequest { await withCheckedContinuation { continuation = $0 } }
        return (Data(response.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
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
        XCTAssertEqual(live.availability, .live)
        XCTAssertEqual(live.errorMessage, "Couldn’t change the fan. Try again.")
    }
    private func waitFor(_ condition: () async -> Bool) async throws {
        for _ in 0..<200 {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for fan command")
    }

    func testSelectionIsOptimisticAndQueuedWritesKeepLatestIntent() async throws {
        let transport = FanProviderTransport([response(true, "On"), response(false, "Auto"), response(true, "On")], blockedRequest: 2)
        let live = provider(transport)
        await live.refresh()
        live.setOn(false)
        XCTAssertEqual(live.fanOn, false)
        XCTAssertEqual(live.fanLabel, "Auto")
        XCTAssertEqual(live.pending, ["fan"])
        try await waitFor { await transport.requests.count == 2 }
        live.setOn(true)
        XCTAssertEqual(live.fanOn, true)
        await transport.release()
        try await waitFor { await transport.requests.count == 3 && live.pending.isEmpty }
        XCTAssertEqual(live.fanLabel, "On")
        let requests = await transport.requests
        for (index, on) in [(1, false), (2, true)] {
            let body = try XCTUnwrap(requests[index].httpBody)
            XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? NSDictionary, ["key": "fan", "on": on] as NSDictionary)
        }
    }

    func testPollStartedBeforeSelectionCannotUndoIt() async throws {
        let transport = FanProviderTransport([response(true, "On"), response(true, "On"), response(false, "Auto")], blockedRequest: 2)
        let live = provider(transport)
        await live.refresh()
        let poll = Task { await live.refresh() }
        try await waitFor { await transport.requests.count == 2 }
        live.setOn(false)
        try await waitFor { await transport.requests.count == 3 && live.pending.isEmpty }
        await transport.release()
        await poll.value
        XCTAssertEqual(live.fanOn, false)
        XCTAssertEqual(live.fanLabel, "Auto")
    }

    func testFailedSelectionRollsBackAndCanRetry() async throws {
        let transport = FanProviderTransport([response(true, "On")])
        let live = provider(transport)
        await live.refresh()
        live.setOn(false)
        XCTAssertEqual(live.fanOn, false)
        try await waitFor { live.errorMessage != nil }
        XCTAssertEqual(live.fanOn, true)
        XCTAssertEqual(live.fanLabel, "On")
        XCTAssertTrue(live.pending.isEmpty)
        XCTAssertEqual(live.availability, .live)
        live.setOn(false)
        XCTAssertNil(live.errorMessage)
        try await waitFor { await transport.requests.count == 3 && live.errorMessage != nil }
        XCTAssertEqual(live.fanOn, true)
    }

    func testMockOffLabelAndToggle() async {
        var climate = ClimateState(); climate.mode = .off
        let mock = MockFanProvider(climate: climate)
        XCTAssertEqual(mock.fanLabel, "Off")
        await mock.toggle()
        XCTAssertEqual(mock.fanOn, true)
    }
}
