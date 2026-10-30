import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LiveLightsProviderTests: XCTestCase {
    func testInitialStateDoesNotStartNetworking() async {
        let transport = LiveStubTransport([.state(.allOn)])
        let provider = makeProvider(transport)
        XCTAssertEqual(provider.availability, .loading)
        XCTAssertEqual(provider.lamps.on, LampState().on)
        XCTAssertNil(provider.fanOn)
        XCTAssertTrue(provider.pending.isEmpty)
        let count = await transport.requestCount
        XCTAssertEqual(count, 0)
    }

    func testEveryFixtureMapsGroupsAndSharedFields() async {
        for variant in LiveFixture.allCases {
            let transport = LiveStubTransport([.state(variant)])
            let provider = makeProvider(transport)
            await provider.refresh()
            XCTAssertEqual(provider.availability, .live)
            XCTAssertEqual(Array(provider.lamps.on[0..<3]), Array(repeating: variant.bedroom, count: 3))
            XCTAssertEqual(Array(provider.lamps.on[3..<8]), Array(repeating: variant.other, count: 5))
            XCTAssertEqual(provider.lamps.ceiling, variant.bedroom)
            XCTAssertEqual(provider.lamps.cabinet, variant.other)
            XCTAssertEqual(provider.lamps.brightness, 65)
            XCTAssertEqual(provider.lamps.kelvin, 2700)
            // Fixture sends slots out of order: mapping must use slot identity.
            XCTAssertEqual(provider.lamps.colors, ["#ff0000", "#0066ff", "#8b5cf6"])
            XCTAssertEqual(provider.fanOn, variant.bedroom)
            XCTAssertEqual(provider.pending, variant == .pending ? ["fan"] : [])
            XCTAssertEqual(provider.lamps.scene, variant.scene?.capitalized ?? "White")
            XCTAssertNil(provider.lamps.activeColor)
            XCTAssertEqual(provider.lamps.lampColors, LampState().lampColors)
            // The wire contract has no party speed. An external party must not invent one.
            XCTAssertEqual(provider.lamps.party, .off)
        }
    }

    func testBedroomToggleIsOptimisticAndThenAppliesServerState() async throws {
        let transport = LiveStubTransport([.state(.allOff), .state(.nullScene)], held: [1])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        XCTAssertTrue(provider.send(.toggle(.bedroom)))
        XCTAssertEqual(provider.lamps.on, [true, true, true, false, false, false, false, false])
        XCTAssertEqual(provider.pending, ["bedroomLamps"])
        try await waitForRequest(transport, count: 2)
        let request = try await capturedRequest(transport, at: 1)
        XCTAssertEqual(request.url?.path, "/trpc/controls.toggle")
        XCTAssertEqual(request.httpMethod, "POST")
        try assertBody(request, equals: ##"{"key":"bedroomLamps","on":true}"##)
        await transport.release(1)
        try await waitUntil { provider.pending.isEmpty }
        XCTAssertEqual(provider.availability, .live)
        XCTAssertTrue(provider.lamps.ceiling) // Comes from returned state, not the optimistic toggle.
        XCTAssertFalse(provider.lamps.cabinet)
        XCTAssertEqual(provider.fanOn, true)
    }

    func testMutationFailureRevertsAllFieldsToLastServerState() async throws {
        let transport = LiveStubTransport([.state(.allOn), .unavailable], held: [1])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        XCTAssertTrue(provider.send(.color(2, "#abcdef")))
        XCTAssertEqual(provider.lamps.colors[2], "#abcdef")
        XCTAssertEqual(provider.lamps.brightness, 100)
        XCTAssertEqual(provider.pending, ["lamps"])
        try await waitForRequest(transport, count: 2)
        await transport.release(1)
        try await waitUntil { if case .unavailable = provider.availability { true } else { false } }
        XCTAssertEqual(provider.lamps.colors[2], "#8b5cf6")
        XCTAssertEqual(provider.lamps.brightness, 65)
        XCTAssertEqual(provider.lamps.scene, "White")
        XCTAssertNil(provider.lamps.activeColor)
        XCTAssertTrue(provider.pending.isEmpty)
    }

    func testRefreshFailurePreservesSnapshotAndCanRecover() async {
        let transport = LiveStubTransport([.state(.allOn), .unavailable, .state(.allOff)])
        let provider = makeProvider(transport)
        await provider.refresh()
        await provider.refresh()
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
        XCTAssertTrue(provider.lamps.isOn(.all))
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertFalse(provider.lamps.anyOn)
    }

    func testUnhandledAndInvalidCommandsReturnFalse() async {
        let transport = LiveStubTransport([])
        let provider = makeProvider(transport)
        for command: HomeCommand in [.target(72), .mode(.cool), .scene("Unknown"), .color(3, nil), .color(0, "invalid")] {
            XCTAssertFalse(provider.send(command))
        }
        XCTAssertTrue(provider.pending.isEmpty)
        let count = await transport.requestCount
        XCTAssertEqual(count, 0)
    }

    func testEachAccessoryUsesExactControlKeyAndExcludesFanFromAll() async throws {
        let pairs: [(Accessory, String)] = [(.all, "all"), (.fan, "fan"), (.lamps, "lamps"),
            (.bedroom, "bedroomLamps"), (.livingRoom, "otherLamps"), (.lights, "lights"),
            (.ceiling, "ceiling"), (.cabinet, "cabinet")]
        for (accessory, key) in pairs {
            let transport = LiveStubTransport([.state(.allOff), .state(.allOn)], held: [1])
            let provider = makeProvider(transport)
            await provider.refresh()
            XCTAssertTrue(provider.send(.toggle(accessory)))
            if accessory == .all { XCTAssertEqual(provider.fanOn, false) }
            if accessory == .fan { XCTAssertFalse(provider.lamps.anyOn); XCTAssertEqual(provider.fanOn, true) }
            try await waitForRequest(transport, count: 2)
            let request = try await capturedRequest(transport, at: 1)
            try assertBody(request, equals: "{\"key\":\"\(key)\",\"on\":true}")
            await transport.release(1)
            try await waitUntil { provider.pending.isEmpty }
            provider.stop()
        }
    }

    func testAllToggleUsesServerANDWhenGroupsHidePartialMembership() async throws {
        let json = LiveFixture.allOn.json.replacingOccurrences(of: "\"all\": {\"on\": true", with: "\"all\": {\"on\": false")
        let transport = LiveStubTransport([.json(json, 200), .state(.allOn)])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        XCTAssertTrue(provider.lamps.isOn(.all)) // Projected groups overstate individual membership.
        provider.send(.toggle(.all))
        try await waitForRequest(transport, count: 2)
        let request = try await capturedRequest(transport, at: 1)
        try assertBody(request, equals: ##"{"key":"all","on":true}"##)
    }

    func testCommandsUseExactMutationInputsAndRetainAcknowledgedPartySpeed() async throws {
        let transport = LiveStubTransport(Array(repeating: .state(.party), count: 8))
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        let cases: [(HomeCommand, String, String)] = [
            (.brightness(42), "setLampBrightness", ##"{"pct":42}"##),
            (.kelvin(4100), "setWhiteKelvin", ##"{"kelvin":4100}"##),
            (.scene("Mood"), "setLampScene", ##"{"scene":"mood"}"##),
            (.color(2, "#aabbcc"), "setLampColor", ##"{"slot":"custom","hex":"#aabbcc"}"##),
            (.color(1, nil), "setLampColor", ##"{"slot":"blue"}"##),
            (.party(.fast), "setLampMode", ##"{"mode":"party","speed":"fast"}"##)
        ]
        for (index, entry) in cases.enumerated() {
            XCTAssertTrue(provider.send(entry.0))
            XCTAssertEqual(provider.pending, ["lamps"])
            try await waitForRequest(transport, count: index + 2)
            try await waitUntil { provider.pending.isEmpty }
            let request = try await capturedRequest(transport, at: index + 1)
            XCTAssertEqual(request.url?.path, "/trpc/controls.\(entry.1)")
            try assertBody(request, equals: entry.2)
        }
        XCTAssertEqual(provider.lamps.party, .fast)
        await provider.refresh()
        XCTAssertEqual(provider.lamps.party, .fast)
    }

    func testQueuedCommandsStayOptimisticAndExecuteInOrder() async throws {
        let transport = LiveStubTransport([.state(.allOn), .state(.allOn), .state(.allOff)], held: [1, 2])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        provider.send(.brightness(20))
        provider.send(.toggle(.bedroom))
        XCTAssertEqual(provider.lamps.brightness, 20)
        XCTAssertFalse(provider.lamps.on[0])
        try await waitForRequest(transport, count: 2)
        let count = await transport.requestCount
        XCTAssertEqual(count, 2) // Second mutation waits for the first response.
        await transport.release(1)
        try await waitForRequest(transport, count: 3)
        XCTAssertEqual(provider.lamps.brightness, 65)
        XCTAssertFalse(provider.lamps.on[0]) // Reapplied on the first response.
        XCTAssertEqual(provider.pending, ["bedroomLamps"])
        await transport.release(2)
        try await waitUntil { provider.pending.isEmpty }
        XCTAssertFalse(provider.lamps.anyOn)
    }

    func testOlderRefreshCannotOverwriteMutation() async throws {
        let transport = LiveStubTransport([.state(.allOff), .state(.allOff), .state(.allOn)], held: [1])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        let refresh = Task { await provider.refresh() }
        try await waitForRequest(transport, count: 2)
        provider.send(.toggle(.all))
        try await waitForRequest(transport, count: 3)
        try await waitUntil { provider.pending.isEmpty }
        XCTAssertTrue(provider.lamps.isOn(.all))
        await transport.release(1)
        await refresh.value
        XCTAssertTrue(provider.lamps.isOn(.all))
        XCTAssertEqual(provider.availability, .live)
    }

    func testStopCancelsWorkAndRestoresConfirmedState() async throws {
        let transport = LiveStubTransport([.state(.allOff), .state(.allOn)], held: [1])
        let provider = makeProvider(transport)
        await provider.refresh()
        provider.send(.toggle(.bedroom))
        try await waitForRequest(transport, count: 2)
        provider.stop()
        XCTAssertFalse(provider.lamps.anyOn)
        XCTAssertTrue(provider.pending.isEmpty)
        await transport.release(1)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(provider.lamps.anyOn)
        XCTAssertEqual(provider.availability, .live)
    }

    func testPollingStartsExplicitlyAndStops() async throws {
        let transport = LiveStubTransport(Array(repeating: .state(.allOn), count: 10))
        let provider = makeProvider(transport)
        provider.startPolling(every: .milliseconds(20))
        try await waitForRequest(transport, count: 2)
        provider.stop()
        let count = await transport.requestCount
        try await Task.sleep(for: .milliseconds(70))
        let after = await transport.requestCount
        XCTAssertEqual(after, count)
    }

    private func makeProvider(_ transport: LiveStubTransport) -> LiveLightsProvider {
        LiveLightsProvider(api: LightsAPI(client: PanelAPIClient(
            configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!),
            transport: transport
        )))
    }

    private func capturedRequest(_ transport: LiveStubTransport, at index: Int) async throws -> URLRequest {
        let request = await transport.request(at: index)
        return try XCTUnwrap(request)
    }

    private func assertBody(_ request: URLRequest, equals json: String) throws {
        let body = try XCTUnwrap(request.httpBody)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? NSDictionary,
                       try JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
    }

    private func waitForRequest(_ transport: LiveStubTransport, count: Int) async throws {
        for _ in 0..<1000 {
            if await transport.requestCount >= count { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Timed out waiting for stub request \(count)")
        throw WaitFailure.timeout
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<1000 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Timed out waiting for provider")
        throw WaitFailure.timeout
    }

    private enum WaitFailure: Error { case timeout }
}

private actor LiveStubTransport: PanelTransport {
    enum Reply: Sendable {
        case state(LiveFixture)
        case json(String, Int)
        case unavailable
    }

    private var requests: [URLRequest] = []
    private let replies: [Reply]
    private let held: Set<Int>
    private var gates: [Int: CheckedContinuation<Void, any Error>] = [:]
    var requestCount: Int { requests.count }

    init(_ replies: [Reply], held: Set<Int> = []) { self.replies = replies; self.held = held }

    func request(at index: Int) -> URLRequest? { requests.indices.contains(index) ? requests[index] : nil }
    func release(_ index: Int) { gates.removeValue(forKey: index)?.resume() }
    private func cancel(_ index: Int) { gates.removeValue(forKey: index)?.resume(throwing: CancellationError()) }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let index = requests.count
        requests.append(request)
        guard replies.indices.contains(index) else { throw URLError(.badServerResponse) }
        if held.contains(index) {
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                try await withCheckedThrowingContinuation { gates[index] = $0 }
            } onCancel: {
                Task { await self.cancel(index) }
            }
        }
        let json: String
        let status: Int
        switch replies[index] {
        case .state(let fixture): json = fixture.json; status = 200
        case .json(let body, let code): json = body; status = code
        case .unavailable:
            json = ##"{"error":{"message":"Service unavailable","code":-32603,"data":{"code":"SERVICE_UNAVAILABLE","httpStatus":503}}}"##
            status = 503
        }
        return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

/// Mirrors features/ctrl/api.ts and service.ts, including fan-only server pending.
private enum LiveFixture: CaseIterable, Sendable {
    case allOn, allOff, pending, party, nullScene, mood, red, blue
    var bedroom: Bool { self != .allOff }
    var other: Bool { self != .allOff && self != .nullScene && self != .pending }
    var scene: String? {
        switch self {
        case .allOn, .pending: "white"
        case .allOff, .nullScene: nil
        case .party: "party"
        case .mood: "mood"
        case .red: "red"
        case .blue: "blue"
        }
    }
    var json: String {
        let sceneJSON = scene.map { "\"\($0)\"" } ?? "null"
        return """
        {"result":{"data":{
          "lamps": {"on": \(bedroom), "count": \((bedroom ? 3 : 0) + (other ? 5 : 0)),
            "brightness": 65, "sub": "\(bedroom ? "On" : "Off")", "pending": false,
            "activeScene": \(sceneJSON), "whiteKelvin": 2700,
            "savedColors": [{"slot":"custom","label":"Custom","hex":"#8b5cf6"},
              {"slot":"blue","label":"Blue","hex":"#0066ff"},
              {"slot":"red","label":"Red","hex":"#ff0000"}]},
          "lights": {"on": \(bedroom), "pending": false},
          "fan": {"on": \(bedroom), "sub": "\(bedroom ? "On" : "Off")", "pending": \(self == .pending)},
          "bedroomLamps": {"on": \(bedroom), "pending": false},
          "otherLamps": {"on": \(other), "pending": false},
          "ceiling": {"on": \(bedroom), "pending": false},
          "cabinet": {"on": \(other), "pending": false},
          "all": {"on": \(bedroom && other), "pending": false}
        }}}
        """
    }
}
