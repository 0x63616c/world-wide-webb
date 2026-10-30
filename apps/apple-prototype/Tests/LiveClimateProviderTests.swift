import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LiveClimateProviderTests: XCTestCase {
    func testInitializationIsOfflineAndMockStillWorks() async {
        let transport = ClimateProviderTransport([.cool])
        let provider = make(transport)
        XCTAssertNil(provider.climate)
        XCTAssertEqual(provider.availability, .loading)
        XCTAssertFalse(provider.send(.low(69)))
        let count = await transport.requests.count
        XCTAssertEqual(count, 0)
        let mock = MockClimateProvider(source: MockHomeDataSource(latency: .zero))
        XCTAssertNotNil(mock.climate)
        XCTAssertTrue(mock.send(.mode(.heat)))
        XCTAssertEqual(mock.climate?.mode, .heat)
        XCTAssertFalse(mock.send(.toggle(.fan)))
    }

    func testAllModesMapAndReportedActionIsPreserved() async {
        for response in [ClimateReply.off, .cool, .heat, .range, .remembered] {
            let provider = make(ClimateProviderTransport([response]))
            await provider.refresh()
            XCTAssertEqual(provider.availability, .live)
            XCTAssertEqual(provider.climate?.mode.rawValue, response.mode)
            XCTAssertEqual(provider.ambientFahrenheit, 72.5)
            XCTAssertEqual(provider.climate?.ambient, 73)
            // Actual device action can disagree with the prototype's temperature heuristic.
            XCTAssertEqual(provider.reportedAction, .idle)
            XCTAssertEqual(provider.climate?.fanOn, false)
            if response == .range { XCTAssertEqual(provider.climate?.low, 68); XCTAssertEqual(provider.climate?.high, 74) }
            if response == .cool { XCTAssertEqual(provider.climate?.target, 70) }
            if response == .heat { XCTAssertEqual(provider.climate?.target, 75) }
            if response == .remembered { XCTAssertEqual(provider.climate?.target, 72); XCTAssertEqual(provider.climate?.low, 69) }
        }
    }

    func testCommandsUseConfirmedResponseForEachRangeEdit() async throws {
        let transport = ClimateProviderTransport([.range, .range, .cool, .range, .range, .range])
        let provider = make(transport)
        defer { provider.stop() }
        await provider.refresh()
        XCTAssertFalse(provider.send(.toggle(.fan)))
        for command in [HomeCommand.mode(.heatCool), .target(71), .low(69), .high(75), .shiftRange(20)] {
            XCTAssertTrue(provider.send(command))
        }
        try await settled(provider)
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 6)
        let expected = [("setMode", ##""heat_cool""##), ("setTarget", "71"),
                        ("setRange", ##"{"low":69,"high":73}"##),
                        ("setRange", ##"{"low":68,"high":75}"##),
                        ("setRange", ##"{"low":71,"high":77}"##)]
        for (request, (path, body)) in zip(requests.dropFirst(), expected) {
            XCTAssertEqual(request.url?.path, "/trpc/climate.\(path)")
            let actual = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody), options: [.fragmentsAllowed]) as AnyObject
            let wanted = try JSONSerialization.jsonObject(with: Data(body.utf8), options: [.fragmentsAllowed]) as AnyObject
            XCTAssertTrue(actual.isEqual(wanted))
        }
    }

    func testValidationFailureKeepsConfirmedStateAndDropsDependentCommands() async throws {
        let transport = ClimateProviderTransport([.range, .invalid, .heat], held: [1])
        let provider = make(transport)
        defer { provider.stop() }
        await provider.refresh()
        XCTAssertTrue(provider.send(.low(76)))
        XCTAssertTrue(provider.send(.high(77)))
        await transport.waitForRequest(2)
        XCTAssertEqual(provider.climate?.low, 68)
        await transport.release(1)
        try await settled(provider)
        XCTAssertEqual(provider.climate?.low, 68)
        XCTAssertEqual(provider.climate?.high, 74)
        XCTAssertEqual(provider.lastError, .server(code: "BAD_REQUEST", message: "low must be at least 2°F below high", httpStatus: 400))
        XCTAssertEqual(provider.availability, .unavailable("low must be at least 2°F below high"))
        let count = await transport.requests.count
        XCTAssertEqual(count, 2)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertNil(provider.lastError)
    }

    func testRefreshCannotOverwriteMutationOrStoppedLifecycle() async throws {
        let transport = ClimateProviderTransport([.cool, .heat, .range, .heat], held: [1, 3])
        let provider = make(transport)
        await provider.refresh()
        let stale = Task { await provider.refresh() }
        await transport.waitForRequest(2)
        XCTAssertTrue(provider.send(.mode(.heatCool)))
        try await settled(provider)
        await transport.release(1)
        await stale.value
        XCTAssertEqual(provider.climate?.mode, .heatCool)
        XCTAssertTrue(provider.send(.mode(.heat)))
        await transport.waitForRequest(4)
        provider.stop()
        await transport.release(3)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(provider.climate?.mode, .heatCool)
        XCTAssertTrue(provider.pending.isEmpty)
    }

    private func make(_ transport: ClimateProviderTransport) -> LiveClimateProvider {
        LiveClimateProvider(api: ClimateAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport)))
    }
    private func settled(_ provider: LiveClimateProvider) async throws {
        let deadline = ContinuousClock.now + .seconds(3)
        while !provider.pending.isEmpty, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(provider.pending.isEmpty)
    }
}

private enum ClimateReply: Equatable, Sendable {
    case off, cool, heat, range, remembered, invalid
    var mode: String {
        switch self { case .off, .remembered, .invalid: "off"; case .cool: "cool"; case .heat: "heat"; case .range: "heat_cool" }
    }
    var json: String {
        if self == .invalid { return ##"{"error":{"message":"low must be at least 2°F below high","code":-32600,"data":{"code":"BAD_REQUEST","httpStatus":400}}}"## }
        let setpoints: String = switch self {
        case .off, .invalid: ##""target":null,"targetLow":null,"targetHigh":null"##
        case .remembered: ##""target":71.5,"targetLow":68.5,"targetHigh":74.5"##
        case .cool: ##""target":70"##
        case .heat: ##""target":75"##
        case .range: ##""targetLow":68,"targetHigh":74"##
        }
        return "{\"result\":{\"data\":{\"mode\":\"\(mode)\",\"ambient\":72.5,\"action\":\"Idle\",\(setpoints)}}}"
    }
}

private actor ClimateProviderTransport: PanelTransport {
    let replies: [ClimateReply]
    let held: Set<Int>
    private var gates: [Int: CheckedContinuation<Void, Never>] = [:]
    private(set) var requests: [URLRequest] = []
    init(_ replies: [ClimateReply], held: Set<Int> = []) { self.replies = replies; self.held = held }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let index = requests.count
        requests.append(request)
        if held.contains(index) { await withCheckedContinuation { gates[index] = $0 } }
        guard replies.indices.contains(index) else { throw URLError(.badServerResponse) }
        let reply = replies[index]
        return (Data(reply.json.utf8), HTTPURLResponse(url: request.url!, statusCode: reply == .invalid ? 400 : 200, httpVersion: nil, headerFields: nil)!)
    }
    func release(_ index: Int) { gates.removeValue(forKey: index)?.resume() }
    func waitForRequest(_ count: Int) async {
        let deadline = ContinuousClock.now + .seconds(3)
        while requests.count < count, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(5)) }
    }
}
