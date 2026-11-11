import Foundation
import Testing

@testable import PanelKit

@Suite(.enabled(if: ProcessInfo.processInfo.environment["WWW_NATIVE_TEST_URL"] != nil))
struct NativeServerRoundTrip {
    @Test func swiftClientReadsAndMutatesRealRustServer() async throws {
        let env = ProcessInfo.processInfo.environment
        let configuration = PanelConfiguration(
            baseURL: URL(string: try #require(env["WWW_NATIVE_TEST_URL"]))!)
        let client = PanelAPIClient(configuration: configuration)
        let climate = try await ClimateAPI(client: client).get()
        #expect(climate.mode == .cool)
        #expect(climate.action == .cooling)
        #expect(climate.ambient == 73)
        #expect(climate.setpoints == .single(72))
        #expect(try await !PanelPINAPI(client: client).verify("000000"))
        let photo = try Data(contentsOf: URL(fileURLWithPath: try #require(env["WWW_NATIVE_TEST_PHOTO"])))
        let photos = PhotosAPI(client: client)
        try await photos.savePhoto(jpeg: photo, capturedAt: Date())
        let frame = try #require(try await photos.booth().groups.first?.frames.first)
        #expect(try await photos.image(collection: "booth-photos", path: frame.path) == photo)

    }
}
