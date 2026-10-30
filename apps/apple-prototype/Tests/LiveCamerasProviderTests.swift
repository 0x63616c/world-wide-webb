import Foundation
import XCTest
import PanelKit
@testable import WorldWideWebb

@MainActor final class LiveCamerasProviderTests: XCTestCase {
    func testFixturesRefreshOnlyRequestedSnapshotsAndKeepMock() async throws {
        let transport = try CameraProviderStub()
        let provider = makeProvider(transport)
        XCTAssertTrue(provider.feeds.isEmpty)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.feeds.map(\.id), ["camera.test_a", "camera.test_b"])
        XCTAssertTrue(provider.frames.isEmpty)
        await provider.refreshSnapshots(ids: ["camera.test_b", "camera.not_listed"])
        XCTAssertNotNil(provider.frames["camera.test_b"])
        XCTAssertNotNil(provider.updatedAt["camera.test_b"])
        XCTAssertNil(provider.frames["camera.test_a"])
        let paths = await transport.paths
        XCTAssertEqual(paths, ["/trpc/cameras.list", "/media/cameras/camera.test_b/snapshot"])
        XCTAssertEqual(MockCamerasProvider().feeds.count, 2)
    }

    func testImageFailureClearsFrameAndRecoveryReplacesIt() async throws {
        let transport = try CameraProviderStub()
        let provider = makeProvider(transport)
        await provider.refresh()
        await provider.refreshSnapshots(ids: ["camera.test_a"])
        XCTAssertNotNil(provider.frames["camera.test_a"])
        await transport.setImage(Data("not an image".utf8))
        await provider.refreshSnapshots(ids: ["camera.test_a"])
        XCTAssertNil(provider.frames["camera.test_a"])
        XCTAssertNil(provider.updatedAt["camera.test_a"])
        await transport.restoreImage()
        await provider.refreshSnapshots(ids: ["camera.test_a"])
        XCTAssertNotNil(provider.frames["camera.test_a"])
        provider.stop()
        XCTAssertTrue(provider.frames.isEmpty)
    }

    func testMissingEndpointEmptyOfflineAndRecovery() async throws {
        let transport = try CameraProviderStub()
        let provider = makeProvider(transport)
        await provider.refresh()
        await transport.setStatus(404)
        await provider.refresh()
        XCTAssertNotEqual(provider.availability, .live)
        XCTAssertTrue(provider.feeds.isEmpty)
        await transport.setStatus(200)
        await transport.setList(#"{"result":{"data":[]}}"#)
        await provider.refresh()
        XCTAssertNotEqual(provider.availability, .live)
        await transport.setList(#"{"result":{"data":[{"id":"camera.a","name":"A","state":"unavailable"}]}}"#)
        await provider.refresh()
        XCTAssertTrue(provider.feeds.isEmpty)
        await transport.restoreList()
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
    }

    func testCancellationAndStopRejectLateFrames() async throws {
        let transport = try CameraProviderStub()
        let provider = makeProvider(transport)
        await provider.refresh()
        await transport.holdImage()
        let task = Task { await provider.refreshSnapshots(ids: ["camera.test_a"]) }
        for _ in 0..<200 {
            if await transport.isHeld { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let held = await transport.isHeld
        XCTAssertTrue(held)
        task.cancel()
        provider.stop()
        await transport.release()
        await task.value
        XCTAssertTrue(provider.frames.isEmpty)
        XCTAssertTrue(provider.updatedAt.isEmpty)
    }

    private func makeProvider(_ transport: CameraProviderStub) -> LiveCamerasProvider {
        LiveCamerasProvider(api: CamerasAPI(configuration: PanelConfiguration(
            baseURL: URL(string: "https://fixture.example.invalid")!), transport: transport))
    }
}

private actor CameraProviderStub: PanelTransport {
    private let originalList: Data
    private let originalImage: Data
    private var list: Data
    private var image: Data
    private var status = 200
    private var hold = false
    private var gate: CheckedContinuation<Void, Never>?
    private(set) var paths: [String] = []
    var isHeld: Bool { gate != nil }
    init() throws {
        let root = Bundle(for: LiveCamerasProviderTests.self).resourceURL!.appendingPathComponent("Fixtures/cameras")
        originalList = try Data(contentsOf: root.appendingPathComponent("list.json"))
        originalImage = try Data(contentsOf: root.appendingPathComponent("snapshot.png"))
        list = originalList; image = originalImage
    }
    func setImage(_ data: Data) { image = data }
    func restoreImage() { image = originalImage }
    func restoreList() { list = originalList }
    func setList(_ json: String) { list = Data(json.utf8) }
    func setStatus(_ value: Int) { status = value }
    func holdImage() { hold = true }
    func release() { gate?.resume(); gate = nil; hold = false }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let snapshot = request.url!.lastPathComponent == "snapshot"
        paths.append(request.url!.path)
        if snapshot && hold { await withCheckedContinuation { gate = $0 } }
        return (snapshot ? image : list, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": snapshot ? "image/png" : "application/json"])!)
    }
}
