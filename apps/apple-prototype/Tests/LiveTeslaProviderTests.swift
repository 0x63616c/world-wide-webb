import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

private actor TeslaProviderTransport: PanelTransport {
    private var files: [String]
    private var holdNext: Bool
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var requests: [URLRequest] = []
    init(_ files: [String], holdNext: Bool = false) { self.files = files; self.holdNext = holdNext }
    func release() { continuation?.resume(); continuation = nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !files.isEmpty else { throw URLError(.notConnectedToInternet) }
        if holdNext {
            holdNext = false
            await withCheckedContinuation { continuation = $0 }
        }
        let url = Bundle(for: LiveTeslaProviderTests.self).resourceURL!
            .appendingPathComponent("Fixtures/tesla/\(files.removeFirst()).json")
        return (try Data(contentsOf: url), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
@MainActor final class LiveTeslaProviderTests: XCTestCase {
    private func provider(_ transport: TeslaProviderTransport) -> LiveTeslaProvider {
        LiveTeslaProvider(api: TeslaAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!), transport: transport)))
    }
    func testStartsUnavailableAndMapsOnlyReportedData() async {
        let transport = TeslaProviderTransport(["ready"])
        let live = provider(transport)
        XCTAssertFalse(live.hasLiveData); XCTAssertEqual(live.availability, .offline)
        XCTAssertNil(live.snapshot); XCTAssertNil(live.data.lat); XCTAssertEqual(live.data.range, 0)
        live.send(.setCharging(false))
        XCTAssertNil(live.requestedAction)
        await live.refresh()
        XCTAssertTrue(live.hasLiveData); XCTAssertEqual(live.availability, .online)
        XCTAssertEqual(live.data.pct, 72); XCTAssertEqual(live.data.range, 200)
        XCTAssertEqual(live.data.rate, 7); XCTAssertTrue(live.data.charging)
        XCTAssertFalse(live.data.preconditioning); XCTAssertEqual(live.data.climate, 68)
        XCTAssertEqual(live.snapshot?.locked, true); XCTAssertEqual(live.data.place, "")
        XCTAssertNil(live.data.lon)
    }
    func testEveryProtocolCommandStagesWithoutWritingAndRequiresFreshPIN() async {
        let transport = TeslaProviderTransport(["ready", "accepted", "ready"])
        let live = provider(transport)
        await live.refresh()
        for (command, expected) in [(TeslaCommand.setCharging(true), TeslaAction.chargeStart),
                                    (.setCharging(false), .chargeStop),
                                    (.setPreconditioning(true), .climateOn),
                                    (.setPreconditioning(false), .climateOff)] {
            live.send(command)
            XCTAssertEqual(live.requestedAction, expected)
            live.cancelCommand()
        }
        let count = await transport.requests.count
        XCTAssertEqual(count, 1)
        live.request(.unlock)
        await live.confirm(pin: "123456")
        XCTAssertNil(live.requestedAction)
        // Service acknowledgement does not change the reported lock.
        XCTAssertEqual(live.snapshot?.locked, true)
        await live.confirm(pin: "123456")
        let requests = await transport.requests
        XCTAssertEqual(requests.map(\.httpMethod), ["GET", "POST", "GET"])
        live.request(.lock)
        XCTAssertEqual(live.requestedAction, .lock)
    }
    func testWrongPINCanRetryWithoutChangingTelemetry() async {
        let transport = TeslaProviderTransport(["ready", "forbidden", "accepted", "ready"])
        let live = provider(transport)
        await live.refresh()
        live.send(.setPreconditioning(true))
        await live.confirm(pin: "123456")
        XCTAssertTrue(live.hasLiveData)
        XCTAssertEqual(live.requestedAction, .climateOn)
        XCTAssertFalse(live.data.preconditioning)
        XCTAssertEqual(live.errorMessage, "PIN not accepted. Try again.")
        await live.confirm(pin: "123456")
        XCTAssertNil(live.requestedAction)
        XCTAssertNil(live.errorMessage)
    }
    func testUnconfiguredMissingEndpointAndOutageFallBackThenRecover() async {
        for failure in ["unconfigured", "unavailable", "absent"] {
            let live = provider(TeslaProviderTransport(["ready", failure, "ready"]))
            await live.refresh()
            live.request(.unlock)
            await live.refresh()
            XCTAssertFalse(live.hasLiveData)
            XCTAssertEqual(live.availability, .offline)
            XCTAssertNil(live.requestedAction)
            XCTAssertEqual(live.data.pct, 0)
            await live.refresh()
            XCTAssertTrue(live.hasLiveData)
            live.stop()
            XCTAssertFalse(live.hasLiveData); XCTAssertNil(live.requestedAction)
        }
    }
    func testFailedWriteDoesNotRetryOrInventSuccess() async {
        let transport = TeslaProviderTransport(["ready"])
        let live = provider(transport)
        await live.refresh(); live.request(.unlock)
        await live.confirm(pin: "123456")
        XCTAssertFalse(live.hasLiveData)
        XCTAssertNil(live.requestedAction)
        XCTAssertEqual(live.snapshot?.locked, true)
        let count = await transport.requests.count
        XCTAssertEqual(count, 2)
    }
    func testStopDiscardsDelayedReadsAndClearsPINRequest() async {
        let transport = TeslaProviderTransport(["ready"], holdNext: true)
        let live = provider(transport)
        let task = Task { await live.refresh() }
        for _ in 0..<1000 {
            if await transport.requests.count == 1 { break }
            await Task.yield()
        }
        live.stop()
        await transport.release()
        await task.value
        XCTAssertFalse(live.hasLiveData)
        XCTAssertFalse(live.busy)
        XCTAssertNil(live.snapshot)
        XCTAssertNil(live.requestedAction)
    }
    func testInvalidPINNeverWritesAndMalformedAcknowledgementFallsBack() async {
        let transport = TeslaProviderTransport(["ready", "ready"])
        let live = provider(transport)
        await live.refresh(); live.request(.unlock)
        await live.confirm(pin: "bad")
        XCTAssertEqual(live.errorMessage, "Enter the six-digit panel PIN.")
        let count = await transport.requests.count
        XCTAssertEqual(count, 1)
        await live.confirm(pin: "123456")
        XCTAssertFalse(live.hasLiveData)
        XCTAssertNil(live.requestedAction)
    }
    func testMaxRangeRoundsToFiveAndHoldsBelowTenPercent() async {
        XCTAssertEqual(LiveTeslaProvider.estimateMaxRange(rangeMiles: 200, batteryPercent: 72), 280)
        XCTAssertEqual(LiveTeslaProvider.estimateMaxRange(rangeMiles: 241, batteryPercent: 78), 310)
        XCTAssertNil(LiveTeslaProvider.estimateMaxRange(rangeMiles: 20, batteryPercent: 9.9))
        let suite = "LiveTeslaProviderTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(305, forKey: LiveTeslaProvider.maxRangeKey)
        let live = LiveTeslaProvider(api: TeslaAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!), transport: TeslaProviderTransport(["ready"]))), defaults: defaults)
        XCTAssertEqual(live.maxRange, 305)
        await live.refresh()
        XCTAssertEqual(live.data.maxRange, 280)
        XCTAssertEqual(defaults.integer(forKey: LiveTeslaProvider.maxRangeKey), 280)
    }
}
