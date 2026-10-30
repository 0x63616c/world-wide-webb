import XCTest
import PanelKit
@testable import WorldWideWebb

@MainActor final class LiveMediaProviderTests: XCTestCase {
    private let config = PanelConfiguration(baseURL: URL(string: "https://media.example.invalid")!)

    private actor Fixture: MediaServing {
        var rows = [PanelMediaVideo(id: "video_one", title: "Synthetic clip", subtitle: "Test video",
                                   url: URL(string: "https://media.example.invalid/one.mp4")!)]
        var failure = false
        func setRows(_ value: [PanelMediaVideo]) { rows = value }
        func setFailure(_ value: Bool) { failure = value }
        func videos() async throws -> [PanelMediaVideo] {
            if failure { throw MediaError.sourceUnavailable }
            return rows
        }
    }

    func testDefaultSourceDoesNotLeakMockData() async {
        let provider = LiveMediaProvider(configuration: config)
        await provider.refresh()
        XCTAssertTrue(provider.items.isEmpty)
        XCTAssertNil(provider.videoURL)
        XCTAssertNotEqual(provider.availability, .live)
        XCTAssertFalse(MockMediaProvider().items.isEmpty)
    }

    func testProjectsStableVideoIDsAndSelectsMatchingStream() async {
        let api = Fixture()
        let provider = LiveMediaProvider(api: api, configuration: config)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.items.map(\.id), ["video_one"])
        XCTAssertEqual(provider.items.first?.kind, .video)
        XCTAssertEqual(provider.stream(for: "video_one")?.url.lastPathComponent, "one.mp4")
        XCTAssertNil(provider.stream(for: "unknown"))
    }

    func testFailureClearsStaleStateAndRecovers() async {
        let api = Fixture()
        let provider = LiveMediaProvider(api: api, configuration: config)
        await provider.refresh()
        await api.setFailure(true)
        await provider.refresh()
        XCTAssertTrue(provider.items.isEmpty)
        XCTAssertNil(provider.videoURL)
        XCTAssertNil(provider.stream(for: "video_one"))
        XCTAssertNotEqual(provider.availability, .live)
        await api.setFailure(false)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        provider.stop()
        XCTAssertTrue(provider.items.isEmpty)
        XCTAssertNil(provider.videoURL)
    }

    func testEmptyDuplicateAndForeignStreamsFailClosed() async {
        let api = Fixture()
        let provider = LiveMediaProvider(api: api, configuration: config)
        let rows = await api.rows
        let foreign = PanelMediaVideo(id: "foreign", title: "Clip", subtitle: "", url: URL(string: "https://foreign.invalid/movie.mp4")!)
        for values in [[], rows + rows, [foreign]] {
            await api.setRows(values)
            await provider.refresh()
            XCTAssertNotEqual(provider.availability, .live)
            XCTAssertTrue(provider.items.isEmpty)
        }
    }

    func testStoppedRefreshCannotRepublishLateResult() async {
        let api = DelayedMedia()
        let provider = LiveMediaProvider(api: api, configuration: config)
        let task = Task { await provider.refresh() }
        while !(await api.waiting) { await Task.yield() }
        provider.stop()
        await api.finish()
        await task.value
        XCTAssertTrue(provider.items.isEmpty)
        XCTAssertNotEqual(provider.availability, .live)
    }
}

private actor DelayedMedia: MediaServing {
    var continuation: CheckedContinuation<[PanelMediaVideo], Never>?
    var waiting: Bool { continuation != nil }
    func videos() async throws -> [PanelMediaVideo] {
        await withCheckedContinuation { continuation = $0 }
    }
    func finish() {
        continuation?.resume(returning: [.init(id: "late", title: "Late result", subtitle: "",
                                              url: URL(string: "https://media.example.invalid/late.mp4")!)])
        continuation = nil
    }
}
