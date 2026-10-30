import AVKit
import PanelKit
import XCTest
@testable import Panel

@MainActor final class MediaPlaybackTests: XCTestCase {
    func testPlayerAdvancesSeeksAndStopsThroughResourceLoader() async throws {
        let file = try XCTUnwrap(Bundle.main.url(forResource: "synthetic", withExtension: "mp4", subdirectory: "Fixtures/media"))
        let transport = PlaybackBytes(data: try Data(contentsOf: file))
        let base = URL(string: "https://media.example.invalid")!
        let stream = try MediaStream(url: base.appendingPathComponent("video.mp4"), configuration:
            .init(baseURL: base, accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret"))
        let playback = MediaPlayback(stream: stream, transport: transport)
        let player = AVPlayer(playerItem: playback.item)
        player.isMuted = true
        defer { player.pause(); player.replaceCurrentItem(with: nil); playback.stop() }
        player.play()
        let deadline = ContinuousClock.now + .seconds(15)
        while player.currentTime().seconds < 0.25 && playback.item.status != .failed && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertEqual(playback.item.status, .readyToPlay)
        XCTAssertGreaterThan(player.currentTime().seconds, 0.25)
        player.pause()
        let sought = await player.seek(to: CMTime(seconds: 5, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        XCTAssertTrue(sought)
        XCTAssertEqual(player.currentTime().seconds, 5, accuracy: 0.1)
        let count = await transport.authenticatedRanges
        XCTAssertGreaterThan(count, 0)
        player.replaceCurrentItem(with: nil)
        playback.stop()
        XCTAssertNil(player.currentItem)
    }
}

private actor PlaybackBytes: MediaByteTransport {
    let data: Data
    var authenticatedRanges = 0
    init(data: Data) { self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard request.value(forHTTPHeaderField: "CF-Access-Client-Id") == "synthetic-id",
              request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "synthetic-secret",
              let range = request.value(forHTTPHeaderField: "Range") else { throw MediaError.invalidResponse }
        authenticatedRanges += 1
        let parts = range.dropFirst(6).split(separator: "-")
        let start = Int(parts[0])!, end = min(Int(parts[1])!, data.count - 1)
        guard start <= end else { throw MediaError.invalidResponse }
        return (data.subdata(in: start..<(end + 1)), HTTPURLResponse(url: request.url!, statusCode: 206,
            httpVersion: nil, headerFields: ["Content-Type": "video/mp4", "Content-Range": "bytes \(start)-\(end)/\(data.count)"])!)
    }
}
