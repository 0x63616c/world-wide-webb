import XCTest
import UIKit
import PanelKit
@testable import Panel

@MainActor final class PhotoBoothModelTests: XCTestCase {
    func testFailureRetainsCapturedBytesAndRetryUsesTheSamePhoto() async throws {
        let (model, transport, bytes) = try makeModel(status: 503)
        let captured = Date(timeIntervalSince1970: 1_800_000_000)
        await model.saveCapturedPhoto(bytes, at: captured).value
        XCTAssertTrue(model.hasUnsavedPhoto)
        XCTAssertNotNil(model.preview)
        XCTAssertNotNil(model.error)
        await transport.setStatus(201)
        let retry = try XCTUnwrap(model.retrySave())
        await retry.value
        XCTAssertFalse(model.hasUnsavedPhoto)
        XCTAssertNil(model.error)
        let uploads = await transport.uploads
        XCTAssertEqual(uploads.count, 2)
        XCTAssertEqual(uploads.map(\.httpBody), [bytes, bytes])
        XCTAssertEqual(uploads.map { $0.value(forHTTPHeaderField: "x-captured-at") }, ["1800000000000", "1800000000000"])
    }
    func testCancellingThePageWaiterDoesNotCancelTheModelOwnedSave() async throws {
        let (model, transport, bytes) = try makeModel(status: 201)
        await transport.holdUpload()
        let saving = model.saveCapturedPhoto(bytes, at: .now)
        let pageWaiter = Task { await saving.value }
        await transport.waitForUpload()
        pageWaiter.cancel()
        await transport.releaseUpload()
        await saving.value
        XCTAssertFalse(model.hasUnsavedPhoto)
        XCTAssertNil(model.error)
        let count = await transport.uploadCount()
        XCTAssertEqual(count, 1)
    }
    private func makeModel(status: Int) throws -> (PhotoBoothCameraModel, BoothModelTransport, Data) {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let transport = BoothModelTransport(root: root, status: status)
        let api = PhotosAPI(client: PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://fixtures.example.invalid")!), transport: transport))
        let cache = PhotoCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("BoothModelTests"))
        let photos = LivePhotosProvider(api: api, cache: cache)
        let image = try XCTUnwrap(UIImage(contentsOfFile: root.appendingPathComponent("photos/image.png").path))
        let data = try XCTUnwrap(image.jpegData(compressionQuality: 0.8))
        return (PhotoBoothCameraModel(api: api, photos: photos), transport, data)
    }
}

private actor BoothModelTransport: PanelTransport {
    let root: URL
    private var status: Int
    private var held = false
    private var release: CheckedContinuation<Void, Never>?
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    private(set) var uploads: [URLRequest] = []
    init(root: URL, status: Int) { self.root = root; self.status = status }
    func setStatus(_ value: Int) { status = value }
    func uploadCount() -> Int { uploads.count }
    func holdUpload() { held = true }
    func waitForUpload() async {
        if !uploads.isEmpty { return }
        await withCheckedContinuation { arrivals.append($0) }
    }
    func releaseUpload() { held = false; release?.resume(); release = nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        if url.path == "/media/booth-photo" {
            uploads.append(request)
            arrivals.forEach { $0.resume() }; arrivals.removeAll()
            if held { await withCheckedContinuation { release = $0 } }
            return (Data(#"{"id":"bp_synthetic","path":"synthetic.jpg"}"#.utf8),
                HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
        let file: String
        switch url.lastPathComponent {
        case "boothPhotos.list": file = "photos/booth.json"
        case "wakePhotos.list": file = "photos/wakes.json"
        case "sessions.list": file = "photos/sessions.json"
        default: throw URLError(.unsupportedURL)
        }
        return (try Data(contentsOf: root.appendingPathComponent(file)),
            HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
