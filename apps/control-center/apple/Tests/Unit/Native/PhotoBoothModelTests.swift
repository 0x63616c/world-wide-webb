import ImageIO
import PanelKit
import UIKit
import UniformTypeIdentifiers
import XCTest

@testable import Panel

@MainActor final class PhotoBoothModelTests: XCTestCase {
    func testFourShotsComposeInOrderAndFailedSaveRetriesWithoutRecapturing() async throws {
        let trace = BoothSequenceTrace()
        let frames = try [UIColor.red, .green, .blue, .yellow].map { color in
            // Camera-sized, CPU-owned JPEG fixtures avoid the simulator's lazy
            // UIKit image provider and invalid tiny-frame pixel-buffer path.
            let size = CGSize(width: 640, height: 480)
            let context = try XCTUnwrap(
                CGContext(
                    data: nil, width: 640, height: 480, bitsPerComponent: 8,
                    bytesPerRow: 640 * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.setFillColor(color.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            let image = try XCTUnwrap(context.makeImage())
            let bytes = NSMutableData()
            let encoder = try XCTUnwrap(
                CGImageDestinationCreateWithData(bytes, UTType.jpeg.identifier as CFString, 1, nil))
            CGImageDestinationAddImage(encoder, image, [kCGImageDestinationLossyCompressionQuality: 1] as CFDictionary)
            XCTAssertTrue(CGImageDestinationFinalize(encoder))
            return bytes as Data
        }
        var captures = 0
        let (model, transport, _) = try makeModel(
            status: 503,
            capture: {
                defer { captures += 1 }
                await trace.record("shot")
                return frames[captures]
            }, sleep: { _ in await trace.record("wait") })
        model.mode = .strip
        model.timerSeconds = 0
        await model.activate(true)
        model.shutter()
        try await finish(model)
        XCTAssertEqual(captures, 4)
        let events = await trace.events
        XCTAssertEqual(
            events,
            ["shot", "wait", "wait", "wait", "shot", "wait", "wait", "wait", "shot", "wait", "wait", "wait", "shot"])
        XCTAssertTrue(model.hasUnsavedPhoto)
        let firstRequest = await transport.firstUpload()
        let first = try XCTUnwrap(firstRequest)
        let bytes = try XCTUnwrap(first.httpBody)
        let image = try XCTUnwrap(UIImage(data: bytes)?.cgImage)
        XCTAssertEqual(image.width, 640)
        XCTAssertEqual(image.height, 1888)
        XCTAssertLessThan(bytes.count, 4 * 1024 * 1024)
        let expected: [[UInt8]] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]
        for (index, rgb) in expected.enumerated() {
            let pixel = try sample(image, x: 320, y: 245 + index * 466)
            for channel in 0..<3 { XCTAssertEqual(Double(pixel[channel]), Double(rgb[channel]), accuracy: 8) }
        }
        let border = try sample(image, x: 5, y: 5)
        XCTAssertTrue(border.prefix(3).allSatisfy { $0 > 245 })
        await transport.setStatus(201)
        await model.retrySave()?.value
        XCTAssertFalse(model.hasUnsavedPhoto)
        XCTAssertNotNil(model.preview, "Keep the finished strip available to inspect")
        let uploads = await transport.uploads
        XCTAssertEqual(uploads.map(\.httpBody), [bytes, bytes])
        XCTAssertEqual(captures, 4, "Retry saves the composed JPEG without retaking photos")
    }
    func testSelectedTimerRunsBeforeTheFirstPhoto() async throws {
        let trace = BoothSequenceTrace()
        let (_, _, bytes) = try makeModel(status: 201)
        let (model, transport, _) = try makeModel(
            status: 201,
            capture: {
                await trace.record("shot")
                return bytes
            }, sleep: { _ in await trace.record("wait") })
        model.timerSeconds = 5
        await model.activate(true)
        model.shutter()
        try await finish(model)
        let events = await trace.events
        XCTAssertEqual(events, ["wait", "wait", "wait", "wait", "wait", "shot"])
        let uploads = await transport.uploads
        XCTAssertEqual(uploads.count, 1)
        XCTAssertEqual(uploads.first?.httpBody, bytes)
    }
    func testLeavingDuringAPartialStripCancelsWithoutUploading() async throws {
        let (_, _, bytes) = try makeModel(status: 201)
        var captures = 0
        let (model, transport, _) = try makeModel(
            status: 201,
            capture: {
                captures += 1
                return bytes
            }, sleep: { _ in try await Task.sleep(for: .seconds(60)) })
        model.mode = .strip
        model.timerSeconds = 0
        await model.activate(true)
        model.shutter()
        for _ in 0..<500 {
            if model.countdown > 0 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(captures, 1)
        await model.activate(false)
        try await finish(model)
        XCTAssertFalse(model.capturing)
        XCTAssertEqual(model.countdown, 0)
        let count = await transport.uploadCount()
        XCTAssertEqual(count, 0)
        XCTAssertFalse(model.hasUnsavedPhoto)
    }
    func testCaptureErrorDoesNotUploadAnIncompleteStrip() async throws {
        let (_, _, bytes) = try makeModel(status: 201)
        var captures = 0
        let (model, transport, _) = try makeModel(
            status: 201,
            capture: {
                captures += 1
                if captures == 3 { throw URLError(.cannotDecodeContentData) }
                return bytes
            }, sleep: { _ in })
        model.mode = .strip
        model.timerSeconds = 0
        await model.activate(true)
        model.shutter()
        try await finish(model)
        XCTAssertNotNil(model.error)
        let count = await transport.uploadCount()
        XCTAssertEqual(count, 0)
    }
    func testStripRejectsMissingOrCorruptFrames() {
        XCTAssertThrowsError(try PhotoBoothStrip.render([]))
        XCTAssertThrowsError(try PhotoBoothStrip.render(Array(repeating: Data([1]), count: 4)))
    }
    private func finish(_ model: PhotoBoothCameraModel) async throws {
        for _ in 0..<700 {
            if !model.capturing && !model.saving { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Capture/save did not finish")
    }
    private func sample(_ image: CGImage, x: Int, y: Int) throws -> [UInt8] {
        let pixel = try XCTUnwrap(image.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)))
        var bytes = [UInt8](repeating: 0, count: 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(
                CGContext(
                    data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return bytes
    }
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
        XCTAssertEqual(
            uploads.map { $0.value(forHTTPHeaderField: "x-captured-at") }, ["1800000000000", "1800000000000"])
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
    private func makeModel(
        status: Int, capture: (@MainActor () async throws -> Data)? = nil,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) throws -> (PhotoBoothCameraModel, BoothModelTransport, Data) {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let transport = BoothModelTransport(root: root, status: status)
        let api = PhotosAPI(
            client: PanelAPIClient(
                configuration: PanelConfiguration(baseURL: URL(string: "https://fixtures.example.invalid")!),
                transport: transport))
        let cache = PhotoCache(
            directory: FileManager.default.temporaryDirectory.appendingPathComponent("BoothModelTests"))
        let photos = LivePhotosProvider(api: api, cache: cache)
        let image = try XCTUnwrap(UIImage(contentsOfFile: root.appendingPathComponent("photos/image.png").path))
        let data = try XCTUnwrap(image.jpegData(compressionQuality: 0.8))
        return (PhotoBoothCameraModel(api: api, photos: photos, capturePhoto: capture, sleep: sleep), transport, data)
    }
}

private actor BoothModelTransport: PanelTransport {
    let root: URL
    private var status: Int
    private var held = false
    private var release: CheckedContinuation<Void, Never>?
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    private(set) var uploads: [URLRequest] = []
    init(root: URL, status: Int) {
        self.root = root
        self.status = status
    }
    func setStatus(_ value: Int) { status = value }
    func uploadCount() -> Int { uploads.count }
    func firstUpload() -> URLRequest? { uploads.first }
    func holdUpload() { held = true }
    func waitForUpload() async {
        if !uploads.isEmpty { return }
        await withCheckedContinuation { arrivals.append($0) }
    }
    func releaseUpload() {
        held = false
        release?.resume()
        release = nil
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        if url.path == "/media/booth-photo" {
            uploads.append(request)
            for arrival in arrivals { arrival.resume() }
            arrivals.removeAll()
            if held { await withCheckedContinuation { release = $0 } }
            return (
                Data(#"{"id":"bp_synthetic","path":"synthetic.jpg"}"#.utf8),
                HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            )
        }
        let file: String
        switch url.lastPathComponent {
        case "booth": file = "photos/booth.json"
        default: throw URLError(.unsupportedURL)
        }
        return (
            try Data(contentsOf: root.appendingPathComponent(file)),
            HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
    }
}

private actor BoothSequenceTrace {
    private(set) var events: [String] = []
    func record(_ event: String) { events.append(event) }
}
