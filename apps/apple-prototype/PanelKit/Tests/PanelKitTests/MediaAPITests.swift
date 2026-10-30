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

    #if os(macOS)
    func testRealHTTPRangesRequireHeadersAndNeverFollowRedirects() async throws {
        let script = try XCTUnwrap(Bundle.module.url(forResource: "server", withExtension: "py", subdirectory: "Fixtures/media"))
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [script.path, "0"] // OS-assigned port; never another job's server.
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        defer { process.terminate(); process.waitUntilExit() }
        let line = output.fileHandleForReading.availableData
        let port = try XCTUnwrap(Int(String(decoding: line, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)))
        let base = URL(string: "http://127.0.0.1:\(port)")!
        let config = PanelConfiguration(baseURL: base, accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret")
        let transport = MediaHTTPTransport()
        let request = try MediaStream(url: base.appendingPathComponent("synthetic.mp4"), configuration: config)
            .request(offset: 16, length: 128)
        let (data, response) = try await transport.send(request)
        XCTAssertEqual(data.count, 128)
        XCTAssertEqual(response.statusCode, 206)
        let partial = PanelConfiguration(baseURL: base, accessClientID: "synthetic-id")
        let denied = try MediaStream(url: base.appendingPathComponent("synthetic.mp4"), configuration: partial)
            .request(offset: 0, length: 2)
        do { _ = try await transport.send(denied); XCTFail("Incomplete credentials must fail") }
        catch { XCTAssertEqual(error as? MediaError, .invalidResponse) }
        let redirect = try MediaStream(url: base.appendingPathComponent("redirect"), configuration: config)
            .request(offset: 0, length: 2)
        do { _ = try await transport.send(redirect); XCTFail("Redirect must fail") }
        catch { XCTAssertEqual(error as? MediaError, .invalidResponse) }
        let (statsData, _) = try await URLSession.shared.data(from: base.appendingPathComponent("stats"))
        let stats = try JSONDecoder().decode([String: Int].self, from: statsData)
        XCTAssertEqual(stats["authenticated_ranges"], 1)
        XCTAssertEqual(stats["denied"], 1)
        XCTAssertEqual(stats["redirects"], 1)
        XCTAssertEqual(stats["redirect_followed"], 0)
    }
    #endif
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
