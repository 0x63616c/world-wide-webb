import Foundation
import Testing
@testable import PanelKit

@Suite struct BoothUploadTests {
    private let jpeg = Data([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])
    @Test func uploadsToExistingGalleryWithTheExactRawBodyContract() async throws {
        let transport = BoothUploadTransport(status: 201)
        let api = PhotosAPI(client: client(transport))
        try await api.savePhoto(jpeg: jpeg, capturedAt: Date(timeIntervalSince1970: 1_800_000_000))
        let request = try #require(await transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/media/booth-photo")
        #expect(request.httpBody == jpeg)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        #expect(request.value(forHTTPHeaderField: "x-mode") == "photo")
        #expect(request.value(forHTTPHeaderField: "x-captured-at") == "1800000000000")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == "synthetic-id")
        #expect(request.value(forHTTPHeaderField: "x-group-id") == nil) // Server mints the capture group.
    }
    @Test func rejectsInvalidOrOversizeBytesBeforeSendingAnything() async {
        let transport = BoothUploadTransport(status: 201)
        let api = PhotosAPI(client: client(transport))
        for data in [Data(), Data([1, 2, 3]), jpeg + Data(count: 4 * 1024 * 1024)] {
            do { try await api.savePhoto(jpeg: data, capturedAt: .now); Issue.record("Invalid photo accepted") }
            catch {}
        }
        #expect(await transport.requests.isEmpty)
    }
    @Test func doesNotReportSavedWhenStorageRejectsThePhoto() async {
        let transport = BoothUploadTransport(status: 503)
        do {
            try await PhotosAPI(client: client(transport)).savePhoto(jpeg: jpeg, capturedAt: .now)
            Issue.record("Failed storage was accepted")
        } catch let error as PanelAPIError { #expect(error == .http(status: 503)) }
        catch { Issue.record("Unexpected error") }
    }
    private func client(_ transport: BoothUploadTransport) -> PanelAPIClient {
        PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://fixtures.example.invalid")!,
            accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret"), transport: transport)
    }
}
private actor BoothUploadTransport: PanelTransport {
    let status: Int
    private(set) var requests: [URLRequest] = []
    init(status: Int) { self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (Data(#"{"id":"bp_synthetic","path":"synthetic.jpg"}"#.utf8),
            HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
