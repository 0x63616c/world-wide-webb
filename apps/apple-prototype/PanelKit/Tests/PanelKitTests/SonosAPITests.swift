import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

@Suite struct SonosAPITests {
    @Test func decodesExactRoomContractAndCalibrationMath() async throws {
        let transport = SonosAPIStub(try fixture("rooms"))
        let state = try await api(transport).soundSystem()
        #expect(state.rooms.count == 6)
        let leader = try #require(state.rooms.first)
        #expect(leader.uuid == "media_player.test_alpha")
        #expect(leader.deviceIp == leader.uuid)
        #expect(leader.memberUuids == ["media_player.test_alpha", "media_player.test_beta"])
        #expect(leader.isCoordinator)
        #expect(leader.trackTitle == "Synthetic Track")
        #expect(leader.trackArtist == "Fixture Artist")
        #expect(leader.albumArtUri == "https://example.invalid/art/test.png")
        #expect(leader.baseline == 120)
        #expect(leader.displayVolume == 50)
        #expect(leader.rawVolume(forDisplay: 50) == 60)
        #expect(leader.rawVolume(forDisplay: 100) == 100)
        #expect(leader.rawVolume(forDisplay: -10) == 0)
        #expect(state.rooms[1].displayVolume == 150)
        #expect(state.rooms[1].muted)
        #expect(state.rooms[1].rawVolume(forDisplay: 50) == 10)
        #expect(state.rooms[2].baseline == nil)
        #expect(state.rooms[2].trackTitle == nil)
        #expect(state.rooms[2].rawVolume(forDisplay: 37) == 37)
        #expect(state.rooms[3].availability == .unavailable)
        #expect(state.rooms[3].displayVolume == 40) // zero baseline is uncalibrated
        #expect(state.rooms[3].rawVolume(forDisplay: 37) == 37)
        #expect(state.rooms[4].availability == .unknown)
        #expect(state.rooms[5].sourceKind == .lineIn)
        #expect(state.diagnostics.controlPlane == "home-assistant")
        let request = try #require(await transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/trpc/sound.soundSystem")
        #expect(request.httpBody == nil)
    }

    @Test func legacyIdentifiersStayOpaqueAndEmptySystemStaysEmpty() async throws {
        let legacy = try await api(SonosAPIStub(try fixture("legacy-identifiers"))).soundSystem()
        #expect(legacy.rooms[0].uuid == "RINCON_00000000000101400")
        #expect(legacy.rooms[0].deviceIp == "192.0.2.10")
        #expect(legacy.rooms[0].sourceKind == .other)
        let empty = try await api(SonosAPIStub(try fixture("empty"))).soundSystem()
        #expect(empty.rooms.isEmpty)
    }

    @Test(arguments: ["void", "void-null"])
    func everyVoidMutationUsesExactPathAndInput(response: String) async throws {
        let transport = SonosAPIStub(try fixture(response))
        let api = api(transport)
        try await api.setVolume(deviceIp: "media_player.test_alpha", volume: 42)
        try await api.setMute(deviceIp: "media_player.test_beta", muted: true)
        for command in SonosTransportCommand.allCases {
            try await api.transport(coordinatorIp: "media_player.test_alpha", command: command)
        }
        try await api.join(memberIp: "media_player.test_beta", coordinatorUuid: "media_player.test_alpha")
        try await api.joinAll(coordinatorEntityId: "media_player.test_alpha", memberEntityIds: ["media_player.test_beta"])
        try await api.leave(memberIp: "media_player.test_beta", memberUuid: "media_player.test_beta")
        try await api.clearCalibration()
        let expected: [(String, String)] = [
            ("sonosSetVolume", #"{"deviceIp":"media_player.test_alpha","volume":42}"#),
            ("sonosSetMute", #"{"deviceIp":"media_player.test_beta","muted":true}"#)
        ] + SonosTransportCommand.allCases.map {
            ("sonosTransport", "{\"coordinatorIp\":\"media_player.test_alpha\",\"command\":\"\($0.rawValue)\"}")
        } + [
            ("sonosGroupJoin", #"{"memberIp":"media_player.test_beta","coordinatorUuid":"media_player.test_alpha"}"#),
            ("sonosGroupJoinAll", #"{"coordinatorEntityId":"media_player.test_alpha","memberEntityIds":["media_player.test_beta"]}"#),
            ("sonosGroupLeave", #"{"memberIp":"media_player.test_beta","memberUuid":"media_player.test_beta"}"#),
            ("sonosClearCalibration", "{}")
        ]
        let requests = await transport.requests
        #expect(requests.count == expected.count)
        for (request, expected) in zip(requests, expected) {
            #expect(request.url?.path == "/trpc/sound." + expected.0)
            #expect(request.httpMethod == "POST")
            let body = try #require(request.httpBody)
            #expect(try JSONSerialization.jsonObject(with: body) as? NSDictionary
                    == JSONSerialization.jsonObject(with: Data(expected.1.utf8)) as? NSDictionary)
        }
    }

    @Test func calibrationReturnsUncappedBaselines() async throws {
        let transport = SonosAPIStub(try fixture("calibration"))
        let baselines = try await api(transport).calibrate()
        #expect(baselines["media_player.test_alpha"] == 120)
        #expect(baselines["media_player.test_gamma"] == nil)
        let request = try #require(await transport.requests.first)
        #expect(request.url?.path == "/trpc/sound.sonosCalibrate")
        #expect(request.httpBody == Data("{}".utf8))
    }

    @Test func rejectsInvalidInputsBeforeNetworking() async throws {
        let transport = SonosAPIStub(try fixture("void"))
        let api = api(transport)
        for volume in [-1, 101] {
            await #expect(throws: PanelAPIError.self) { try await api.setVolume(deviceIp: "media_player.test_alpha", volume: volume) }
        }
        await #expect(throws: PanelAPIError.self) { try await api.join(memberIp: "test", coordinatorUuid: "") }
        await #expect(throws: PanelAPIError.self) { try await api.leave(memberIp: "test", memberUuid: "") }
        await #expect(throws: PanelAPIError.self) { try await api.joinAll(coordinatorEntityId: "192.0.2.10", memberEntityIds: ["media_player.test_beta"]) }
        await #expect(throws: PanelAPIError.self) { try await api.joinAll(coordinatorEntityId: "media_player.test_alpha", memberEntityIds: []) }
        await #expect(throws: PanelAPIError.self) { try await api.joinAll(coordinatorEntityId: "media_player.test_alpha", memberEntityIds: ["invalid"]) }
        #expect(await transport.requests.isEmpty)
    }

    @Test func voidAdapterDoesNotSwallowErrorsOrMalformedEnvelopes() async throws {
        for json in ["{}", #"{"result":null}"#, #"{"result":{"data":{"unexpected":true}}}"#, #"{"result":{"unexpected":true}}"#] {
            await #expect(throws: PanelAPIError.self) {
                try await api(SonosAPIStub(Data(json.utf8))).clearCalibration()
            }
        }
        for status in [200, 503] {
            do {
                try await api(SonosAPIStub(try fixture("unavailable"), status: status)).clearCalibration()
                Issue.record("Expected service error")
            } catch let error as PanelAPIError { #expect(error.isServiceUnavailable) }
        }
        await #expect(throws: PanelAPIError.http(status: 403)) {
            try await api(SonosAPIStub(try fixture("void"), status: 403)).clearCalibration()
        }
        // An empty result must still fail for a query or a non-void calibration result.
        await #expect(throws: PanelAPIError.self) { _ = try await api(SonosAPIStub(try fixture("void"))).soundSystem() }
        await #expect(throws: PanelAPIError.self) { _ = try await api(SonosAPIStub(try fixture("void"))).calibrate() }
        await #expect(throws: PanelAPIError.notConfigured) { _ = try await SonosAPI(configuration: nil).soundSystem() }
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/sonos"))
        return try Data(contentsOf: url)
    }

    private func api(_ transport: SonosAPIStub) -> SonosAPI {
        SonosAPI(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport)
    }
}

private actor SonosAPIStub: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    init(_ data: Data, status: Int = 200) { self.data = data; self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
