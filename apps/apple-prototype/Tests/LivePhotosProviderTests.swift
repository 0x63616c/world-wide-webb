import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LivePhotosProviderTests: XCTestCase {
    func testListingsSortAndMapWithoutReplacingMock() async throws {
        let (provider, _, directory) = makeProvider()
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertTrue(provider.photos.isEmpty)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.frames.map(\.id), ["booth:bp_fixture", "wake:2027-01-15T08:00:00.000Z-0.jpg"])
        XCTAssertEqual(provider.photos.count, 2)
        XCTAssertEqual(provider.sessions.first?.eventCount, 1)
        XCTAssertEqual(MockPhotosProvider().photos.count, 3)
    }

    func testPrivateGateBlocksImagesAndWritesThenRelocks() async throws {
        let (provider, transport, directory) = makeProvider()
        defer { try? FileManager.default.removeItem(at: directory) }
        await provider.refresh()
        let photo = try XCTUnwrap(provider.frames.first)
        do { _ = try await provider.image(photo); XCTFail("Locked image loaded") } catch {}
        await provider.remove(photo)
        await provider.clearFilter(photo)
        let lockedRequests = await transport.paths
        XCTAssertFalse(lockedRequests.contains("boothPhotos.remove"))
        let rejected = await provider.unlock(pin: "999999")
        XCTAssertFalse(rejected)
        let accepted = await provider.unlock(pin: "135790")
        XCTAssertTrue(accepted)
        _ = try await provider.image(photo)
        _ = try await provider.image(photo)
        let imageRequests = await transport.paths.filter { $0 == "bp_fixture.jpg" }.count
        XCTAssertEqual(imageRequests, 1)
        await provider.clearFilter(photo)
        await provider.remove(photo)
        let paths = await transport.paths
        XCTAssertTrue(paths.contains("boothPhotos.clearFilter"))
        XCTAssertTrue(paths.contains("boothPhotos.remove"))
        XCTAssertEqual(provider.frames.count, 1)
        provider.lock()
        XCTAssertFalse(provider.unlocked)
        do { _ = try await provider.image(photo); XCTFail("Locked cache loaded") } catch {}
    }

    func testUnavailableClearsStaleDataAndRecovers() async throws {
        let (provider, transport, directory) = makeProvider()
        defer { try? FileManager.default.removeItem(at: directory) }
        await provider.refresh()
        await transport.setUnavailable(true)
        await provider.refresh()
        XCTAssertTrue(provider.frames.isEmpty)
        XCTAssertTrue(provider.sessions.isEmpty)
        XCTAssertFalse(provider.unlocked)
        XCTAssertEqual(provider.availability, .unavailable("Photos are unavailable."))
        await transport.setUnavailable(false)
        await provider.refresh()
        XCTAssertEqual(provider.photos.count, 2)
    }

    func testWakePhotosAreReadOnlyAndFailedBoothWriteRetainsData() async throws {
        let (provider, transport, directory) = makeProvider()
        defer { try? FileManager.default.removeItem(at: directory) }
        await provider.refresh()
        let accepted = await provider.unlock(pin: "135790")
        XCTAssertTrue(accepted)
        let wake = try XCTUnwrap(provider.frames.last)
        await provider.remove(wake)
        await provider.clearFilter(wake)
        let before = await transport.paths
        XCTAssertFalse(before.contains("boothPhotos.remove"))
        let booth = try XCTUnwrap(provider.frames.first)
        await transport.setUnavailable(true)
        await provider.remove(booth)
        XCTAssertEqual(provider.frames.count, 2)
        XCTAssertNotNil(provider.error)
        XCTAssertFalse(provider.pending)
    }

    func testCancelledRefreshCannotPublish() async {
        let (provider, _, directory) = makeProvider()
        defer { try? FileManager.default.removeItem(at: directory) }
        let task = Task { await provider.refresh() }
        task.cancel()
        await task.value
        XCTAssertTrue(provider.frames.isEmpty)
        XCTAssertFalse(provider.unlocked)
    }

    private func makeProvider() -> (LivePhotosProvider, PhotosProviderTransport, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("PanelKit/Tests/PanelKitTests/Fixtures/photos")
        let transport = PhotosProviderTransport(root: root)
        let client = PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://fixtures.example.invalid")!), transport: transport)
        return (LivePhotosProvider(api: PhotosAPI(client: client), cache: PhotoCache(directory: directory)), transport, directory)
    }
}

private actor PhotosProviderTransport: PanelTransport {
    let root: URL
    private(set) var paths: [String] = []
    private var unavailable = false
    private var removed = false
    private var cleared = false
    init(root: URL) { self.root = root }
    func setUnavailable(_ value: Bool) { unavailable = value }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let path = url.lastPathComponent
        paths.append(path)
        guard !unavailable else { throw URLError(.notConnectedToInternet) }
        let data: Data
        var image = false
        switch path {
        case "boothPhotos.list":
            let bytes = try Data(contentsOf: root.appendingPathComponent(removed ? "empty-booth.json" : "booth.json"))
            data = cleared ? Data(String(decoding: bytes, as: UTF8.self).replacingOccurrences(of: "\"mono\"", with: "null").utf8) : bytes
        case "wakePhotos.list": data = try Data(contentsOf: root.appendingPathComponent("wakes.json"))
        case "sessions.list": data = try Data(contentsOf: root.appendingPathComponent("sessions.json"))
        case "settings.get": data = try Data(contentsOf: root.appendingPathComponent("settings.json"))
        case "boothPhotos.remove": removed = true; data = Data(#"{"result":{"data":{"removed":1}}}"#.utf8)
        case "boothPhotos.clearFilter": cleared = true; data = Data(#"{"result":{"data":{"cleared":1}}}"#.utf8)
        default: data = try Data(contentsOf: root.appendingPathComponent("image.png")); image = true
        }
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": image ? "image/png" : "application/json"])!)
    }
}
