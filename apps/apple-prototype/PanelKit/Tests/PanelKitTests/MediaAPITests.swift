import AVFoundation
import Foundation
import XCTest
@testable import PanelKit

final class MediaAPITests: XCTestCase {
    private let origin = URL(string: "https://media.example.invalid")!
    private var configuration: PanelConfiguration {
        .init(baseURL: origin, accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret")
    }

    func testCurrentBackendIsExplicitlyUnavailable() async {
        do { _ = try await MediaAPI().videos(); XCTFail("No media source exists") }
        catch { XCTAssertEqual(error as? MediaError, .sourceUnavailable) }
    }

    func testRangesCarryCompleteAccessPairWithoutURLCredentials() throws {
        let stream = try MediaStream(url: origin.appendingPathComponent("media/library/video/stream"), configuration: configuration)
        let request = try stream.request(offset: 8, length: 16)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Range"), "bytes=8-23")
        XCTAssertEqual(request.value(forHTTPHeaderField: "CF-Access-Client-Id"), "synthetic-id")
        XCTAssertEqual(request.value(forHTTPHeaderField: "CF-Access-Client-Secret"), "synthetic-secret")
        XCTAssertNil(request.url?.query)
        XCTAssertFalse(String(reflecting: stream).contains("synthetic"))
        XCTAssertFalse(String(describing: stream).contains("example.invalid"))
    }

    func testIncompleteAccessPairSendsNeitherHeader() throws {
        for credentials: (String?, String?) in [(nil, nil), ("id", nil), (nil, "secret"), ("", "secret"), ("id", "")] {
            let config = PanelConfiguration(baseURL: origin, accessClientID: credentials.0, accessClientSecret: credentials.1)
            let request = try MediaStream(url: origin.appendingPathComponent("video.mp4"), configuration: config)
                .request(offset: 0, length: 2)
            XCTAssertNil(request.value(forHTTPHeaderField: "CF-Access-Client-Id"))
            XCTAssertNil(request.value(forHTTPHeaderField: "CF-Access-Client-Secret"))
        }
    }

    func testRejectsForeignOriginsAndCredentialBearingURLs() {
        for raw in ["https://other.example.invalid/video.mp4", "http://media.example.invalid/video.mp4",
                    "https://media.example.invalid:444/video.mp4", "file:///tmp/video.mp4",
                    "https://id:secret@media.example.invalid/video.mp4",
                    "https://media.example.invalid/video.mp4?token=synthetic", "https://media.example.invalid/video.mp4#fragment"] {
            XCTAssertThrowsError(try MediaStream(url: URL(string: raw)!, configuration: configuration))
        }
    }

    func testDefaultHTTPSPortAndLoopbackDevelopment() throws {
        _ = try MediaStream(url: URL(string: "https://media.example.invalid:443/video.mp4")!, configuration: configuration)
        let local = URL(string: "http://localhost:18733")!
        _ = try MediaStream(url: local.appendingPathComponent("video.mp4"), configuration: .init(baseURL: local))
    }

    func testInvalidRangesAreRejected() throws {
        let stream = try MediaStream(url: origin, configuration: configuration)
        for (offset, length): (Int64, Int) in [(-1, 1), (0, 0), (0, MediaStream.chunkSize + 1), (Int64.max, 1)] {
            XCTAssertThrowsError(try stream.request(offset: offset, length: length))
        }
    }

    func testRejectsBadRangeResponsesAndLoginPages() throws {
        let data = Data(repeating: 0, count: 2)
        func response(_ range: String, status: Int = 206, mime: String = "video/mp4") -> HTTPURLResponse {
            HTTPURLResponse(url: origin, statusCode: status, httpVersion: nil,
                            headerFields: ["Content-Range": range, "Content-Type": mime])!
        }
        let valid = try MediaByteRange(response: response("bytes 0-1/20"), data: data, offset: 0, length: 2)
        XCTAssertEqual(valid.total, 20)
        _ = try MediaByteRange(response: response("bytes 18-19/20"), data: data, offset: 18, length: 8)
        for range in ["", "bytes */20", "bytes 1-2/20", "bytes 0-2/20", "bytes 0-1/1", "bytes 0-1/*"] {
            XCTAssertThrowsError(try MediaByteRange(response: response(range), data: data, offset: 0, length: 2))
        }
        XCTAssertThrowsError(try MediaByteRange(response: response("bytes 0-1/20"), data: data, offset: 0, length: 8))
        XCTAssertThrowsError(try MediaByteRange(response: response("bytes 0-1/20", status: 200), data: data, offset: 0, length: 2))
        XCTAssertThrowsError(try MediaByteRange(response: response("bytes 0-1/20", mime: "text/html"), data: data, offset: 0, length: 2))
    }

    @MainActor func testAVFoundationLoadsSyntheticMP4ThroughAuthenticatedRanges() async throws {
        let file = try XCTUnwrap(Bundle.module.url(forResource: "synthetic", withExtension: "mp4", subdirectory: "Fixtures/media"))
        let transport = SyntheticMediaBytes(data: try Data(contentsOf: file))
        let playback = MediaPlayback(stream: try MediaStream(url: origin.appendingPathComponent("video.mp4"), configuration: configuration), transport: transport)
        defer { playback.stop() }
        let playable = try await playback.item.asset.load(.isPlayable)
        let duration = try await playback.item.asset.load(.duration)
        XCTAssertTrue(playable)
        XCTAssertEqual(duration.seconds, 8, accuracy: 0.1)
        let requests = await transport.requests
        XCTAssertFalse(requests.isEmpty)
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "synthetic-secret" })
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Range") != nil })
    }
}

private actor SyntheticMediaBytes: MediaByteTransport {
    let data: Data
    var requests: [URLRequest] = []
    init(data: Data) { self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let range = request.value(forHTTPHeaderField: "Range")!.dropFirst(6).split(separator: "-")
        let start = Int(range[0])!, end = min(Int(range[1])!, data.count - 1)
        let bytes = data.subdata(in: start..<(end + 1))
        return (bytes, HTTPURLResponse(url: request.url!, statusCode: 206, httpVersion: nil,
            headerFields: ["Content-Type": "video/mp4", "Content-Range": "bytes \(start)-\(end)/\(data.count)"])!)
    }
}
