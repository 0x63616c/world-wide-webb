import Foundation
import Testing

@testable import PanelKit

@Suite(.enabled(if: ProcessInfo.processInfo.environment["WWW_NATIVE_TEST_URL"] != nil))
struct NativeServerRoundTrip {
    @Test func swiftClientReadsAndMutatesRealRustServer() async throws {
        let env = ProcessInfo.processInfo.environment
        let configuration = PanelConfiguration(
            baseURL: URL(string: try #require(env["WWW_NATIVE_TEST_URL"]))!,
            apiToken: try #require(env["WWW_NATIVE_TEST_TOKEN"]))
        let client = PanelAPIClient(configuration: configuration)
        let walks = WalksAPI(client: client)
        #expect(try await walks.state().active == nil)
        let started = try await walks.start(source: .ipad)
        let active = try #require(started.active)
        #expect(active.source == .ipad)
        let stopped = try await walks.stop(id: active.id)
        #expect(stopped.active == nil)
        let history = try await walks.history(limit: 10)
        #expect(history.walks.contains { $0.id == active.id })
        #expect(try await !PanelPINAPI(client: client).verify("000000"))
        let photo = try Data(contentsOf: URL(fileURLWithPath: try #require(env["WWW_NATIVE_TEST_PHOTO"])))
        let photos = PhotosAPI(client: client)
        try await photos.savePhoto(jpeg: photo, capturedAt: Date())
        let frame = try #require(try await photos.booth().groups.first?.frames.first)
        #expect(try await photos.image(collection: "booth-photos", path: frame.path) == photo)
        let denied = PanelAPIClient(
            configuration: PanelConfiguration(baseURL: configuration.baseURL, apiToken: "fixture-invalid-token"))
        await #expect(throws: PanelAPIError.self) { _ = try await WalksAPI(client: denied).state() }
    }
}
