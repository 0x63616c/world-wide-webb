import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LiveSonosProviderTests: XCTestCase {
    private let alpha = "media_player.test_alpha"
    private let beta = "media_player.test_beta"
    private let gamma = "media_player.test_gamma"
    private let offline = "media_player.test_offline"

    func testOptInEmptyInitialStateAndMockDefault() async throws {
        let transport = SonosProviderStub([])
        let provider = makeProvider(transport)
        XCTAssertEqual(provider.availability, .loading)
        XCTAssertTrue(provider.rooms.isEmpty)
        XCTAssertTrue(provider.roomDetails.isEmpty)
        XCTAssertFalse(provider.supportsPlaybackPosition)
        let count = await transport.count
        XCTAssertEqual(count, 0)
        let mock = MockSonosProvider(source: MockHomeDataSource(latency: .zero, fixedNow: .distantPast))
        XCTAssertFalse(mock.rooms.isEmpty)
        XCTAssertTrue(mock.supportsPlaybackPosition)
        XCTAssertFalse(mock.send(.target(72)))
    }

    func testMapsStableIdentityGroupsCalibrationAndRealMetadataWithoutFakePlayback() async throws {
        let provider = makeProvider(SonosProviderStub([.state()]))
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.rooms.map(\.id), [alpha, beta, gamma, offline])
        XCTAssertEqual(provider.rooms[0].displayVolume, 50)
        XCTAssertEqual(provider.rooms[1].displayVolume, 150)
        XCTAssertEqual(provider.rooms[1].coordinator, alpha)
        XCTAssertEqual(provider.rooms[0].baseline, 120)
        // Duplicate display names do not collapse identities or route writes to the wrong speaker.
        XCTAssertEqual(provider.roomDetails[alpha]?.name, provider.roomDetails[beta]?.name)
        XCTAssertEqual(provider.roomDetails[alpha]?.trackTitle, "Synthetic Track")
        XCTAssertEqual(provider.roomDetails[alpha]?.sourceKind, .spotify)
        XCTAssertEqual(provider.roomDetails[offline]?.availability, .unavailable)
        XCTAssertEqual(provider.diagnostics?.controlPlane, "home-assistant")
        for room in provider.rooms {
            XCTAssertNil(room.trackTitle)
            XCTAssertNil(room.trackArtist)
            XCTAssertEqual(room.positionSeconds, 0)
            XCTAssertEqual(room.durationSeconds, 0)
            XCTAssertEqual(room.position(at: .distantFuture), 0)
        }
        XCTAssertFalse(provider.send(.seek(alpha, 100)))
        XCTAssertFalse(provider.send(.playMedia(alpha, 1)))
        XCTAssertFalse(provider.send(.volume(offline, 50)))
        XCTAssertFalse(provider.send(.volume("Test Room", 50)))
        XCTAssertFalse(provider.send(.target(72)))
    }

    func testVolumeIsOptimisticUsesBaselineAndQueriesAfterVoidAcknowledgement() async throws {
        let transport = SonosProviderStub([.state(), .void, .state(alphaVolume: 24)], held: [1])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        XCTAssertTrue(provider.send(.volume(alpha, 20)))
        XCTAssertEqual(provider.rooms[0].rawVolume, 24)
        XCTAssertEqual(provider.pending, [alpha, "sound"])
        try await waitFor(transport, count: 2)
        try await assertRequest(transport, at: 1, path: "sonosSetVolume", json: #"{"deviceIp":"media_player.test_alpha","volume":24}"#)
        await transport.release(1)
        try await settled(provider)
        XCTAssertEqual(provider.rooms[0].rawVolume, 24)
        let request = await transport.request(2)
        XCTAssertEqual(request?.httpMethod, "GET")
        XCTAssertEqual(request?.url?.path, "/trpc/sound.soundSystem")
    }

    func testGroupAndGlobalLockUseEachRoomsBaselineAndSkipOfflineRooms() async throws {
        for global in [false, true] {
            let mutations = global ? 3 : 2
            let transport = SonosProviderStub([.state()] + Array(repeating: .void, count: mutations) + [.state()])
            let provider = makeProvider(transport)
            defer { provider.stop() }
            await provider.refresh()
            provider.send(global ? .globalLock : .groupLock)
            provider.send(.volume(beta, 50))
            try await settled(provider)
            try await assertRequest(transport, at: 1, path: "sonosSetVolume", json: #"{"deviceIp":"media_player.test_alpha","volume":60}"#)
            try await assertRequest(transport, at: 2, path: "sonosSetVolume", json: #"{"deviceIp":"media_player.test_beta","volume":10}"#)
            if global {
                try await assertRequest(transport, at: 3, path: "sonosSetVolume", json: #"{"deviceIp":"media_player.test_gamma","volume":50}"#)
            }
        }
    }

    func testRawVolumeMuteTransportAndTopologyUseExactTargets() async throws {
        let cases: [(HomeCommand, String, String)] = [
            (.rawVolume(beta, 200), "sonosSetVolume", #"{"deviceIp":"media_player.test_beta","volume":100}"#),
            (.mute(beta), "sonosSetMute", #"{"deviceIp":"media_player.test_beta","muted":false}"#),
            (.transport(beta, .next), "sonosTransport", #"{"coordinatorIp":"media_player.test_alpha","command":"next"}"#),
            (.transport(beta, .pause), "sonosTransport", #"{"coordinatorIp":"media_player.test_alpha","command":"pause"}"#),
            (.join(gamma, beta), "sonosGroupJoin", #"{"memberIp":"media_player.test_gamma","coordinatorUuid":"media_player.test_alpha"}"#),
            (.joinAll(beta), "sonosGroupJoinAll", #"{"coordinatorEntityId":"media_player.test_alpha","memberEntityIds":["media_player.test_gamma"]}"#),
            (.leave(beta), "sonosGroupLeave", #"{"memberIp":"media_player.test_beta","memberUuid":"media_player.test_beta"}"#)
        ]
        for (command, path, json) in cases {
            let transport = SonosProviderStub([.state(), .void, .state()])
            let provider = makeProvider(transport)
            defer { provider.stop() }
            await provider.refresh()
            XCTAssertTrue(provider.send(command))
            try await settled(provider)
            XCTAssertEqual(provider.availability, .live)
            try await assertRequest(transport, at: 1, path: path, json: json)
        }
    }

    func testCalibrationUsesServerBaselinesAndClearUnlocksAfterConfirmation() async throws {
        let transport = SonosProviderStub([.state(), .calibration, .state(alphaBaseline: 160), .void, .state(alphaBaseline: nil)])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        provider.send(.calibrate)
        try await settled(provider)
        XCTAssertEqual(provider.rooms[0].baseline, 160)
        XCTAssertEqual(provider.rooms[0].displayVolume, 38)
        provider.send(.globalLock)
        provider.send(.clearCalibration)
        try await settled(provider)
        XCTAssertNil(provider.rooms[0].baseline)
        XCTAssertFalse(provider.globalLock)
        try await assertRequest(transport, at: 1, path: "sonosCalibrate", json: "{}")
        try await assertRequest(transport, at: 3, path: "sonosClearCalibration", json: "{}")
    }

    func testMutationFailureRevertsOptimismDropsQueueAndDoesNotRetry() async throws {
        let transport = SonosProviderStub([.state(), .unavailable], held: [1])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        provider.send(.volume(alpha, 10))
        provider.send(.mute(beta))
        XCTAssertEqual(provider.rooms[0].rawVolume, 12)
        XCTAssertFalse(provider.rooms[1].muted)
        try await waitFor(transport, count: 2)
        await transport.release(1)
        try await settled(provider)
        XCTAssertEqual(provider.rooms[0].rawVolume, 60)
        XCTAssertTrue(provider.rooms[1].muted)
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
        let count = await transport.count
        XCTAssertEqual(count, 2)
    }

    func testStaleRefreshCannotOverwriteMutationAndStopCancelsPendingWork() async throws {
        let transport = SonosProviderStub([.state(), .state(alphaVolume: 1), .void, .state(alphaVolume: 36), .void], held: [1, 4])
        let provider = makeProvider(transport)
        await provider.refresh()
        let refresh = Task { await provider.refresh() }
        try await waitFor(transport, count: 2)
        provider.send(.volume(alpha, 30))
        try await settled(provider)
        await transport.release(1)
        await refresh.value
        XCTAssertEqual(provider.rooms[0].rawVolume, 36)
        provider.send(.volume(alpha, 80))
        try await waitFor(transport, count: 5)
        provider.stop()
        await transport.release(4)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertTrue(provider.pending.isEmpty)
        XCTAssertEqual(provider.rooms[0].rawVolume, 36)
        let count = await transport.count
        XCTAssertEqual(count, 5)
    }

    func testSliderQueueCoalescesTrailingValuesAndRetainsLatestOptimism() async throws {
        let transport = SonosProviderStub([.state(), .void, .state(alphaVolume: 12), .void, .state(alphaVolume: 48)], held: [1, 3])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        provider.send(.volume(alpha, 10))
        try await waitFor(transport, count: 2)
        for value in 20...40 { provider.send(.volume(alpha, value)) }
        XCTAssertEqual(provider.rooms[0].rawVolume, 48)
        await transport.release(1)
        try await waitFor(transport, count: 4)
        XCTAssertEqual(provider.rooms[0].rawVolume, 48)
        try await assertRequest(transport, at: 3, path: "sonosSetVolume", json: #"{"deviceIp":"media_player.test_alpha","volume":48}"#)
        await transport.release(3)
        try await settled(provider)
        let count = await transport.count
        XCTAssertEqual(count, 5)
    }

    func testFailedPostWriteQueryRemainsUnavailableAndRefreshRecovers() async throws {
        let transport = SonosProviderStub([.state(), .void, .unavailable, .state(alphaVolume: 24), .empty])
        let provider = makeProvider(transport)
        defer { provider.stop() }
        await provider.refresh()
        provider.send(.volume(alpha, 20))
        try await settled(provider)
        guard case .unavailable = provider.availability else { return XCTFail("Expected unavailable") }
        XCTAssertEqual(provider.rooms[0].rawVolume, 60)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.rooms[0].rawVolume, 24)
        await provider.refresh()
        XCTAssertTrue(provider.rooms.isEmpty)
        XCTAssertTrue(provider.roomDetails.isEmpty)
    }

    func testPollingStartsExplicitlyAndStops() async throws {
        let transport = SonosProviderStub(Array(repeating: .state(), count: 100))
        let provider = makeProvider(transport)
        provider.startPolling(every: .milliseconds(20))
        try await waitFor(transport, count: 2)
        provider.stop()
        let before = await transport.count
        try await Task.sleep(for: .milliseconds(60))
        let after = await transport.count
        XCTAssertEqual(before, after)
    }

    private func makeProvider(_ transport: SonosProviderStub) -> LiveSonosProvider {
        LiveSonosProvider(api: SonosAPI(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!
        ), transport: transport))
    }

    private func assertRequest(_ transport: SonosProviderStub, at index: Int, path: String, json: String) async throws {
        let captured = await transport.request(index)
        let request = try XCTUnwrap(captured)
        XCTAssertEqual(request.url?.path, "/trpc/sound." + path)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? NSDictionary,
                       try JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
    }

    private func settled(_ provider: LiveSonosProvider) async throws {
        for _ in 0..<1000 {
            if provider.pending.isEmpty { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Provider did not settle")
        throw WaitFailure.timeout
    }

    private func waitFor(_ transport: SonosProviderStub, count: Int) async throws {
        for _ in 0..<1000 {
            if await transport.count >= count { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Missing stub request")
        throw WaitFailure.timeout
    }
    private enum WaitFailure: Error { case timeout }
}

private actor SonosProviderStub: PanelTransport {
    enum Reply: Sendable {
        case state(alphaVolume: Int = 60, alphaBaseline: Int? = 120)
        case void, calibration, unavailable, empty

        var json: String {
            switch self {
            case .void: return #"{"result":{}}"#
            case .calibration: return #"{"result":{"data":{"media_player.test_alpha":160}}}"#
            case .unavailable:
                return #"{"error":{"message":"Synthetic failure","code":-32603,"data":{"code":"SERVICE_UNAVAILABLE","httpStatus":503}}}"#
            case .empty: return envelope("[]")
            case .state(let volume, let baseline):
                // Synthetic contract from features/sound/api.ts; legacy IP/UUID fields are HA IDs.
                let specifications: [(String, String, Int, Int?, Bool, Bool)] = [
                    ("alpha", "alpha", volume, baseline, false, true),
                    ("beta", "alpha", 30, 20, true, true),
                    ("gamma", "gamma", 40, nil, false, true),
                    ("offline", "offline", 10, 0, false, false)
                ]
                let rooms = specifications.map { id, coordinator, raw, baseline, muted, available in
                    """
                    {"name":"Test Room","uuid":"media_player.test_\(id)","deviceIp":"media_player.test_\(id)",
                     "coordinatorUuid":"media_player.test_\(coordinator)",
                     "memberUuids":\(coordinator == "alpha" ? #"["media_player.test_alpha","media_player.test_beta"]"# : "[\"media_player.test_\(id)\"]"),
                     "isCoordinator":\(id == coordinator),"volume":\(raw),"baseline":\(baseline.map(String.init) ?? "null"),
                     "muted":\(muted),"transportState":"\(available ? "PLAYING" : "UNAVAILABLE")",
                     "sourceLabel":"Spotify","sourceKind":"spotify","trackTitle":"Synthetic Track",
                     "trackArtist":"Fixture Artist","albumArtUri":"https://example.invalid/art/test.png",
                     "availability":"\(available ? "available" : "unavailable")",
                     "groupStatus":"\(id == coordinator ? "Standalone" : "Following test_alpha")"}
                    """
                }.joined(separator: ",")
                return envelope("[\(rooms)]")
            }
        }

        private func envelope(_ rooms: String) -> String {
            """
            {"result":{"data":{"rooms":\(rooms),"diagnostics":{"controlPlane":"home-assistant",
            "queriedAt":"2026-01-01T00:00:00.000Z","message":"Synthetic rooms"}}}}
            """
        }
    }

    private var requests: [URLRequest] = []
    private let replies: [Reply]
    private let held: Set<Int>
    private var gates: [Int: CheckedContinuation<Void, any Error>] = [:]
    var count: Int { requests.count }
    init(_ replies: [Reply], held: Set<Int> = []) { self.replies = replies; self.held = held }
    func request(_ index: Int) -> URLRequest? { requests.indices.contains(index) ? requests[index] : nil }
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
            } onCancel: { Task { await self.cancel(index) } }
        }
        let status: Int
        if case .unavailable = replies[index] { status = 503 } else { status = 200 }
        return (Data(replies[index].json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
