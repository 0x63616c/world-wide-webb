import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LiveSpotifyProviderTests: XCTestCase {
    func testKeepsLastReadWhenRefreshFails() async {
        let transport = SpotifyTestTransport([.state, .failure])
        let provider = make(transport)
        await provider.refresh()
        XCTAssertEqual(provider.roomID, "media_player.test_speaker")
        await provider.refresh()
        XCTAssertNotNil(provider.state)
        XCTAssertNotNil(provider.error)
    }

    func testFailedPlaybackRollsBackOptimisticStateWithoutRetry() async throws {
        let transport = SpotifyTestTransport([.state, .failure], held: [1])
        let provider = make(transport)
        await provider.refresh()
        provider.transport("play")
        XCTAssertTrue(provider.playing)
        await transport.waitForRequest(2)
        await transport.release(1)
        try await settled { !provider.pending }
        XCTAssertFalse(provider.playing)
        XCTAssertNotNil(provider.error)
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests.last?.url?.lastPathComponent, "spotify.transport")
    }

    func testLateLibraryCannotReplaceNewSource() async throws {
        let transport = SpotifyTestTransport([.state, .library("Old"), .library("New")], held: [1])
        let provider = make(transport)
        await provider.refresh()
        provider.browse()
        await transport.waitForRequest(2)
        provider.selectSource("media_player.new_library")
        try await settled { provider.library?.title == "New" }
        await transport.release(1)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(provider.library?.title, "New")
        XCTAssertEqual(provider.sourceID, "media_player.new_library")
    }

    private func make(_ transport: SpotifyTestTransport) -> LiveSpotifyProvider {
        LiveSpotifyProvider(api: SpotifyAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!), transport: transport)))
    }
    private func settled(_ predicate: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(3)
        while !predicate(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(predicate())
    }
}

private enum SpotifyTestReply: Sendable {
    case state, failure, library(String)
    var json: String {
        switch self {
        case .state: #"{"result":{"data":{"configured":true,"accounts":[],"rooms":[{"id":"media_player.test_speaker","name":"Test speaker","coordinator":"media_player.test_speaker","available":true,"playing":false,"title":null,"artist":null}]}}}"#
        case .failure: "{}"
        case .library(let title): "{\"result\":{\"data\":{\"title\":\"\(title)\",\"items\":[]}}}"
        }
    }
}
private actor SpotifyTestTransport: PanelTransport {
    let replies: [SpotifyTestReply]
    let held: Set<Int>
    private var gates: [Int: CheckedContinuation<Void, Never>] = [:]
    private(set) var requests: [URLRequest] = []
    init(_ replies: [SpotifyTestReply], held: Set<Int> = []) { self.replies = replies; self.held = held }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let index = requests.count
        requests.append(request)
        if held.contains(index) { await withCheckedContinuation { gates[index] = $0 } }
        guard replies.indices.contains(index) else { throw URLError(.badServerResponse) }
        if case .failure = replies[index] { throw URLError(.notConnectedToInternet) }
        return (Data(replies[index].json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    func release(_ index: Int) { gates.removeValue(forKey: index)?.resume() }
    func waitForRequest(_ count: Int) async {
        let deadline = ContinuousClock.now + .seconds(3)
        while requests.count < count, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(5)) }
    }
}
