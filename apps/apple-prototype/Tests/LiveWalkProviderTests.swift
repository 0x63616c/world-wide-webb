import Foundation
import XCTest
import PanelKit
@testable import WorldWideWebb

@MainActor final class LiveWalkProviderTests: XCTestCase {
    private let serverDate = ISO8601DateFormatter().date(from: "2026-10-01T12:00:00Z")!
    private let walkID = "11111111-1111-4111-8111-111111111111"

    func testRefreshLoadsServerStateAndHistoryWithoutStartingNetworkInInit() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active")], "walks.history": [.fixture("history")]])
        let provider = makeProvider(transport)
        let initialCount = await transport.count("walks.state")
        XCTAssertEqual(initialCount, 0)
        XCTAssertFalse(provider.hasLoadedState)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.historyAvailability, .live)
        XCTAssertEqual(provider.activeWalk?.id, walkID)
        XCTAssertEqual(provider.activeWalk?.startedBy, .iPad)
        XCTAssertEqual(provider.history.count, 2)
        XCTAssertEqual(provider.history[1].startedBy, .iPhone)
        XCTAssertEqual(provider.activeWalk?.duration(at: provider.serverNow(at: serverDate.addingTimeInterval(90))), 90)
    }

    func testClockSkewUsesRoundTripMidpointWithoutChangingServerDates() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active", held: true)]])
        var clock = serverDate.addingTimeInterval(-120)
        let provider = makeProvider(transport, now: { clock })
        let refresh = Task { await provider.refresh() }
        try await waitFor(transport, "walks.state")
        clock = clock.addingTimeInterval(2)
        await transport.release("walks.state")
        await refresh.value
        XCTAssertEqual(provider.serverTimeOffset, 119, accuracy: 0.001)
        XCTAssertEqual(provider.activeWalk?.startedAt, serverDate)
        XCTAssertEqual(provider.activeWalk?.duration(at: provider.serverNow(at: clock)), 1)
    }

    func testOptimisticStartUsesUUIDAndServerTimeThenAdoptsAnotherDevicesWalk() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-idle")], "walks.start": [.fixture("start", held: true)]])
        let provider = makeProvider(transport)
        await provider.refresh()
        provider.start(at: serverDate.addingTimeInterval(50))
        XCTAssertEqual(provider.activeWalk?.id, "22222222-2222-4222-8222-222222222222")
        XCTAssertTrue(provider.isMutating)
        provider.start(at: serverDate) // Duplicate tap never submits another mutation.
        try await waitFor(transport, "walks.start")
        let request = try await transport.request("walks.start")
        XCTAssertEqual(try body(request), ["id": "22222222-2222-4222-8222-222222222222", "source": "iphone"])
        await transport.release("walks.start")
        try await waitUntil { !provider.isMutating }
        XCTAssertEqual(provider.activeWalk?.id, walkID) // Server single-active winner replaces optimism.
        XCTAssertEqual(provider.activeWalk?.startedAt, serverDate)
        XCTAssertEqual(provider.activeWalk?.startedBy, .iPad)
        let count = await transport.count("walks.start")
        XCTAssertEqual(count, 1)
    }

    func testStartFailureRollsBackAndExplicitRetryReusesUUID() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-idle")],
            "walks.start": [.offline, .fixture("start")]])
        let provider = makeProvider(transport)
        await provider.refresh()
        provider.start(at: serverDate)
        try await waitUntil { !provider.isMutating }
        XCTAssertNil(provider.activeWalk)
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
        provider.start(at: serverDate.addingTimeInterval(5))
        try await waitFor(transport, "walks.start", count: 2)
        try await waitUntil { !provider.isMutating }
        let first = try await transport.request("walks.start", at: 0)
        let retry = try await transport.request("walks.start", at: 1)
        XCTAssertEqual(try body(first)["id"], try body(retry)["id"])
        XCTAssertEqual(provider.availability, .live)
    }

    func testStopIsOptimisticAndReloadsHistoryWithAuthoritativeEnd() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active")],
            "walks.stop": [.fixture("stop", held: true)],
            "walks.history": [.fixture("history-empty"), .fixture("history")]])
        let provider = makeProvider(transport)
        await provider.refresh()
        provider.stop(at: serverDate.addingTimeInterval(10))
        XCTAssertNil(provider.activeWalk)
        XCTAssertEqual(provider.history.first?.endedAt, serverDate.addingTimeInterval(10))
        try await waitFor(transport, "walks.stop")
        let request = try await transport.request("walks.stop")
        XCTAssertEqual(try body(request), ["id": walkID])
        await transport.release("walks.stop")
        try await waitUntil { provider.history.first?.endedAt == self.serverDate.addingTimeInterval(1800) }
        XCTAssertEqual(provider.history.count, 2)
        XCTAssertNil(provider.activeWalk)
    }

    func testFailedStopRestoresActiveWalkAndHistory() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active")], "walks.stop": [.offline]])
        let provider = makeProvider(transport)
        await provider.refresh()
        provider.stop(at: serverDate.addingTimeInterval(-20))
        XCTAssertEqual(provider.history.first?.endedAt, serverDate) // Optimistic end is clamped.
        try await waitUntil { !provider.isMutating }
        XCTAssertEqual(provider.activeWalk?.id, walkID)
        XCTAssertTrue(provider.history.isEmpty)
    }

    func testOfflinePollKeepsLastKnownTimerAndHistoryThenRecovers() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active"), .offline, .fixture("stop")],
            "walks.history": [.fixture("history")]])
        let provider = makeProvider(transport)
        await provider.refresh()
        let previousHistory = provider.history
        await provider.refresh()
        XCTAssertEqual(provider.activeWalk?.id, walkID)
        XCTAssertEqual(provider.history, previousHistory)
        guard case .unavailable = provider.availability else { return XCTFail("Expected offline") }
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertNil(provider.activeWalk)
    }

    func testHistoryFailureDoesNotRollbackSuccessfulStopAndRetriesNextPoll() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active"), .fixture("stop")],
            "walks.stop": [.fixture("stop")], "walks.history": [.fixture("history-empty"), .offline, .fixture("history")]])
        let provider = makeProvider(transport)
        await provider.refresh()
        provider.stop(at: serverDate)
        try await waitUntil { if case .unavailable = provider.historyAvailability { true } else { false } }
        XCTAssertNil(provider.activeWalk)
        XCTAssertEqual(provider.availability, .live)
        XCTAssertTrue(provider.history.isEmpty) // Do not keep an invented optimistic end after a history error.
        await provider.refresh()
        XCTAssertEqual(provider.historyAvailability, .live)
        XCTAssertEqual(provider.history.count, 2)
    }

    func testOlderPollCannotOverwriteSuccessfulStart() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-idle"), .fixture("state-idle", held: true)],
            "walks.start": [.fixture("start")]])
        let provider = makeProvider(transport)
        await provider.refresh()
        let poll = Task { await provider.refresh() }
        try await waitFor(transport, "walks.state", count: 2)
        provider.start(at: serverDate)
        try await waitUntil { !provider.isMutating }
        await transport.release("walks.state")
        await poll.value
        XCTAssertEqual(provider.activeWalk?.id, walkID)
    }

    func testOlderHistoryCannotOverwriteCompletedMutation() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active")],
            "walks.stop": [.fixture("stop")], "walks.history": [.fixture("history-empty", held: true), .fixture("history")]])
        let provider = makeProvider(transport)
        let refresh = Task { await provider.refresh() }
        try await waitFor(transport, "walks.history")
        provider.stop(at: serverDate)
        try await waitUntil { provider.history.count == 2 }
        await transport.release("walks.history")
        await refresh.value
        XCTAssertEqual(provider.history.count, 2)
        XCTAssertNil(provider.activeWalk)
    }

    func testScenePollingStopsAndForegroundRefreshesImmediately() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-idle"), .fixture("state-active"), .fixture("stop")]])
        let provider = makeProvider(transport, interval: .milliseconds(20))
        defer { provider.setSceneActive(false) }
        provider.setSceneActive(true)
        try await waitUntil { provider.activeWalk != nil }
        provider.setSceneActive(false)
        let count = await transport.count("walks.state")
        try await Task.sleep(for: .milliseconds(60))
        let after = await transport.count("walks.state")
        XCTAssertEqual(after, count)
        provider.setSceneActive(true)
        try await waitUntil { provider.activeWalk == nil }
        let historyCount = await transport.count("walks.history")
        XCTAssertGreaterThanOrEqual(historyCount, 2)
    }

    func testForegroundDoesNotWaitForCancelledBackgroundRead() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-idle", held: true), .fixture("state-active")]])
        let provider = makeProvider(transport)
        defer { provider.setSceneActive(false) }
        provider.setSceneActive(true)
        try await waitFor(transport, "walks.state")
        provider.setSceneActive(false)
        provider.setSceneActive(true)
        try await waitUntil { provider.activeWalk != nil }
        await transport.release("walks.state")
        XCTAssertEqual(provider.activeWalk?.id, walkID)
    }

    func testActivityObservesRemoteStartCorrectsSkewAvoidsDuplicatesAndEnds() async throws {
        let localDate = serverDate.addingTimeInterval(-120)
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active"), .fixture("state-active"), .fixture("stop")]])
        let provider = makeProvider(transport, now: { localDate })
        let driver = RecordingWalkActivityDriver()
        let sync = WalkActivitySync(provider: provider, driver: driver)
        XCTAssertTrue(driver.states.isEmpty) // Unknown startup must not end a restored activity.
        await provider.refresh()
        try await waitUntil { driver.states.count == 1 }
        XCTAssertEqual(driver.states, [.walking(id: walkID, startedAt: localDate)])
        await provider.refresh()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(driver.states.count, 1)
        await provider.refresh()
        try await waitUntil { driver.states.last == .idle }
        XCTAssertNil(sync.unavailableReason)
    }

    func testActivityEndsAfterOptimisticStartRollsBack() async throws {
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-idle")], "walks.start": [.fixture("unavailable", held: true)]])
        let provider = makeProvider(transport)
        let driver = RecordingWalkActivityDriver()
        let sync = WalkActivitySync(provider: provider, driver: driver)
        await provider.refresh()
        provider.start(at: serverDate)
        try await waitUntil { driver.states.contains { if case .walking = $0 { true } else { false } } }
        try await waitFor(transport, "walks.start")
        await transport.release("walks.start")
        try await waitUntil { !provider.isMutating && driver.states.last == .idle }
        XCTAssertNil(sync.unavailableReason)
    }

    func testActivityFailureDoesNotAffectWalkAndRetriesOnNextRefresh() async throws {
        var clock = serverDate
        let transport = WalkProviderTransport(["walks.state": [.fixture("state-active")]])
        let provider = makeProvider(transport, now: { clock })
        let driver = RecordingWalkActivityDriver()
        driver.failNext = true
        let sync = WalkActivitySync(provider: provider, driver: driver)
        await provider.refresh()
        try await waitUntil { sync.unavailableReason != nil }
        XCTAssertEqual(provider.activeWalk?.id, walkID)
        clock = clock.addingTimeInterval(5)
        await provider.refresh()
        try await waitUntil { sync.unavailableReason == nil }
        XCTAssertEqual(driver.states.count, 2)
    }

    func testEitherDevicesStartReachesOtherWithinFiveSecondsWithFakeClock() async throws {
        for starterIsPhone in [true, false] {
            let clock = WalkSyncTestClock(date: serverDate)
            let server = SharedWalkServer(clock: clock)
            let api = WalksAPI(client: PanelAPIClient(configuration: PanelConfiguration(
                baseURL: URL(string: "https://panel.example.invalid")!), transport: server))
            // Deliberately different device clocks; server timestamps never change.
            let phone = LiveWalkProvider(api: api, device: .iPhone, clock: clock.clock(offset: -120))
            let panel = LiveWalkProvider(api: api, device: .iPad, clock: clock.clock(offset: 90))
            phone.setSceneActive(true); panel.setSceneActive(true)
            defer { phone.setSceneActive(false); panel.setSceneActive(false) }
            try await fakeEventually { phone.hasLoadedState && panel.hasLoadedState && clock.pendingSleeps == 2 }
            let starter = starterIsPhone ? phone : panel
            let observer = starterIsPhone ? panel : phone
            let started = clock.date
            starter.start(at: clock.date.addingTimeInterval(starterIsPhone ? -120 : 90))
            try await fakeEventually { !starter.isMutating && starter.activeWalk != nil }
            XCTAssertNil(observer.activeWalk)
            clock.advance(.seconds(3))
            for _ in 0..<50 { await Task.yield() }
            XCTAssertNil(observer.activeWalk)
            clock.advance(.seconds(1))
            try await fakeEventually { observer.activeWalk != nil && clock.pendingSleeps == 2 }
            XCTAssertLessThanOrEqual(clock.date.timeIntervalSince(started), 5)
            XCTAssertEqual(observer.activeWalk, starter.activeWalk)
            XCTAssertEqual(observer.activeWalk?.startedAt, started)
            XCTAssertEqual(observer.activeWalk?.startedBy, starterIsPhone ? .iPhone : .iPad)
            XCTAssertEqual(phone.activeWalk?.duration(at: phone.serverNow(at: clock.date.addingTimeInterval(-120))), 4)
            XCTAssertEqual(panel.activeWalk?.duration(at: panel.serverNow(at: clock.date.addingTimeInterval(90))), 4)
            let historyReads = await server.historyReads
            XCTAssertEqual(historyReads, 4) // Initial reads, local mutation, remote state change.
            clock.advance(.seconds(4))
            try await fakeEventually { clock.pendingSleeps == 2 }
            let unchangedHistoryReads = await server.historyReads
            XCTAssertEqual(unchangedHistoryReads, historyReads) // updatedAt suppresses unchanged history reads.

            observer.stop(at: clock.date.addingTimeInterval(starterIsPhone ? 90 : -120))
            try await fakeEventually { !observer.isMutating && observer.history.count == 1 }
            clock.advance(.seconds(4))
            try await fakeEventually { starter.activeWalk == nil && starter.history.count == 1 }
            XCTAssertEqual(phone.history, panel.history)
        }
    }

    func testFakeClockOfflineLastKnownBackoffAndForegroundRecovery() async throws {
        let clock = WalkSyncTestClock(date: serverDate)
        let server = SharedWalkServer(clock: clock)
        let api = WalksAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!), transport: server))
        let provider = LiveWalkProvider(api: api, device: .iPhone, clock: clock.clock())
        provider.setSceneActive(true)
        defer { provider.setSceneActive(false) }
        try await fakeEventually { provider.hasLoadedState && clock.pendingSleeps == 1 }
        provider.start(at: clock.date)
        try await fakeEventually { !provider.isMutating && provider.activeWalk != nil }
        let confirmed = provider.activeWalk
        let confirmedAt = provider.lastSyncedAt
        await server.setOffline(true)
        clock.advance(.seconds(4))
        try await fakeEventually { if case .unavailable = provider.availability { clock.pendingSleeps == 1 } else { false } }
        let failedReads = await server.stateReads
        clock.advance(.seconds(4))
        for _ in 0..<50 { await Task.yield() }
        let duringBackoff = await server.stateReads
        XCTAssertEqual(duringBackoff, failedReads)
        XCTAssertEqual(provider.activeWalk, confirmed)
        XCTAssertEqual(provider.lastSyncedAt, confirmedAt)
        provider.setSceneActive(false)
        try await fakeEventually { clock.pendingSleeps == 0 }
        clock.advance(.seconds(60))
        let backgroundReads = await server.stateReads
        XCTAssertEqual(backgroundReads, failedReads)
        await server.setOffline(false)
        _ = try await api.stop(id: XCTUnwrap(confirmed?.id)) // Other device stopped it while this scene slept.
        provider.setSceneActive(true)
        try await fakeEventually { provider.availability == .live && provider.activeWalk == nil && provider.history.count == 1 }
    }

    private func fakeEventually(_ condition: () -> Bool) async throws {
        for _ in 0..<10_000 { if condition() { return }; await Task.yield() }
        throw WalkTestFailure.timeout
    }

    private func makeProvider(_ transport: WalkProviderTransport, now: (() -> Date)? = nil,
                              interval: Duration = .seconds(5)) -> LiveWalkProvider {
        let date = serverDate
        return LiveWalkProvider(api: WalksAPI(client: PanelAPIClient(
            configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport)),
            device: .iPhone, now: now ?? { date },
            makeID: { UUID(uuidString: "22222222-2222-4222-8222-222222222222")! }, pollInterval: interval)
    }

    private func body(_ request: URLRequest) throws -> [String: String] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: String])
    }

    private func waitFor(_ transport: WalkProviderTransport, _ path: String, count: Int = 1) async throws {
        for _ in 0..<1000 {
            if await transport.count(path) >= count { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        throw WalkTestFailure.timeout
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<1000 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        throw WalkTestFailure.timeout
    }
}

private enum WalkTestFailure: Error { case timeout, activityDisabled }

@MainActor private final class RecordingWalkActivityDriver: WalkActivityDriving {
    var states: [WalkActivityState] = []
    var failNext = false
    func reconcile(_ state: WalkActivityState) async throws {
        states.append(state)
        if failNext { failNext = false; throw WalkTestFailure.activityDisabled }
    }
}

private actor WalkProviderTransport: PanelTransport {
    enum Reply: Sendable {
        case fixture(String, held: Bool = false)
        case offline
    }
    private let replies: [String: [Reply]]
    private var requests: [String: [URLRequest]] = [:]
    private var gates: [String: CheckedContinuation<Void, any Error>] = [:]
    init(_ replies: [String: [Reply]]) { self.replies = replies }
    func count(_ path: String) -> Int { requests[path, default: []].count }
    func request(_ path: String, at index: Int = 0) throws -> URLRequest {
        guard let values = requests[path], values.indices.contains(index) else { throw WalkTestFailure.timeout }
        return values[index]
    }
    func release(_ path: String) { gates.removeValue(forKey: path)?.resume() }
    private func cancel(_ path: String) { gates.removeValue(forKey: path)?.resume(throwing: CancellationError()) }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.lastPathComponent
        let index = count(path)
        requests[path, default: []].append(request)
        let options = replies[path] ?? [.fixture("history-empty")]
        let reply = options[min(index, options.count - 1)]
        guard case .fixture(let name, let held) = reply else { throw URLError(.notConnectedToInternet) }
        if held {
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                try await withCheckedThrowingContinuation { gates[path] = $0 }
            } onCancel: { Task { await self.cancel(path) } }
        }
        // Read the same synthetic recordings as the SwiftPM contract tests, without changing project.yml resources.
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("PanelKit/Tests/PanelKitTests/Fixtures/walks")
        let data = try Data(contentsOf: fixtures.appendingPathComponent(name + ".json"))
        return (data, HTTPURLResponse(url: request.url!, statusCode: name == "unavailable" ? 503 : 200,
                                    httpVersion: nil, headerFields: nil)!)
    }
}

/// Shared authoritative synthetic server: both clients use the real WalksAPI wire adapter.
private actor SharedWalkServer: PanelTransport {
    let clock: WalkSyncTestClock
    private var active: [String: String]?
    private var history: [[String: String]] = []
    private var updatedAt = "1970-01-01T00:00:00.000Z"
    private var offline = false
    private(set) var stateReads = 0
    private(set) var historyReads = 0
    init(clock: WalkSyncTestClock) { self.clock = clock }
    func setOffline(_ value: Bool) { offline = value }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.lastPathComponent
        if path == "walks.state" { stateReads += 1 }
        if path == "walks.history" { historyReads += 1 }
        if offline { throw URLError(.notConnectedToInternet) }
        let date = await clock.date
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let now = formatter.string(from: date)
        let input = try request.httpBody.map { try JSONSerialization.jsonObject(with: $0) as! [String: String] } ?? [:]
        if path == "walks.start", active == nil {
            active = ["id": input["id"]!, "source": input["source"]!, "startedAt": now, "createdAt": now, "updatedAt": now]
            updatedAt = now
        }
        if path == "walks.stop", var walk = active, walk["id"] == input["id"] {
            walk["endedAt"] = now; walk["updatedAt"] = now
            history.insert(walk, at: 0); active = nil; updatedAt = now
        }
        var wireActive = active?.mapValues { $0 as Any }
        wireActive?["endedAt"] = NSNull() // Required nullable field in the WWW-27 contract.
        let payload: [String: Any] = path == "walks.history" ? ["walks": history] :
            ["active": wireActive.map { $0 as Any } ?? NSNull(), "updatedAt": updatedAt, "serverTime": now]
        return (try JSONSerialization.data(withJSONObject: ["result": ["data": payload]]),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

@MainActor private final class WalkSyncTestClock {
    var date: Date
    private var elapsed: Duration = .zero
    private var sleepers: [UUID: (Duration, CheckedContinuation<Void, any Error>)] = [:]
    var pendingSleeps: Int { sleepers.count }
    init(date: Date) { self.date = date }
    func clock(offset: TimeInterval = 0) -> SyncClock {
        SyncClock(now: { self.date.addingTimeInterval(offset) }, elapsed: { self.elapsed }, sleep: { delay in
            let id = UUID()
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                try await withCheckedThrowingContinuation { self.sleepers[id] = (self.elapsed + delay, $0) }
            } onCancel: {
                Task { @MainActor in self.sleepers.removeValue(forKey: id)?.1.resume(throwing: CancellationError()) }
            }
        })
    }
    func advance(_ duration: Duration) {
        elapsed += duration
        date += Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
        let ready = sleepers.filter { $0.value.0 <= elapsed }
        for id in ready.keys { sleepers.removeValue(forKey: id)?.1.resume() }
    }
}
