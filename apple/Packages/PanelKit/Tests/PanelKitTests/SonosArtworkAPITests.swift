import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

@Suite struct SonosArtworkAPITests {
    @Test func fetchesOnlyTheProxyAndKeepsCredentialsOnConfiguredOrigin() async throws {
        let transport = ArtworkStub()
        let api = SonosArtworkAPI(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!,
            accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret"), transport: transport)
        #expect(try await api.artwork(room: "media_player.example") == Data([1, 2, 3]))
        let request = try #require(await transport.request)
        #expect(request.url?.absoluteString == "https://panel.example.invalid/media/sonos/media_player.example/artwork")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == "synthetic-id")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "synthetic-secret")
        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        await #expect(throws: PanelAPIError.self) { _ = try await api.artwork(room: "media_player.x/../secret") }
        #expect(await transport.count == 1)
    }

    @Test func missingEndpointAndNonImagesFailWithoutInventingArtwork() async throws {
        for (status, mime) in [(404, "image/png"), (200, "text/html"), (302, "image/png")] {
            let api = SonosArtworkAPI(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!),
                transport: ArtworkStub(status: status, mime: mime))
            await #expect(throws: PanelAPIError.self) { _ = try await api.artwork(room: "media_player.example") }
        }
    }
}

private actor ArtworkStub: PanelTransport {
    private(set) var request: URLRequest?
    private(set) var count = 0
    let status: Int
    let mime: String
    init(status: Int = 200, mime: String = "image/png") { self.status = status; self.mime = mime }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request; count += 1
        return (Data([1, 2, 3]), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": mime])!)
    }
}
