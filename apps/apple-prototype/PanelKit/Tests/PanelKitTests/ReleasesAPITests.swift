import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

@Suite struct ReleasesAPITests {
    @Test func decodesReleaseAndUsesPanelTransport() async throws {
        let transport = ReleaseStub(try fixture("latest"))
        let release = try await api(transport).latest()
        #expect(release.app == "panel")
        #expect(release.build == 123)
        #expect(release.updatedAt == "2026-10-30T12:00:00.000Z")
        let request = try #require(await transport.requests.first)
        #expect(request.url?.path == "/trpc/releases.latest")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == "synthetic-id")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "synthetic-secret")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let components = try #require(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
        #expect(components.queryItems?.first?.value == #"{"app":"panel"}"#)
    }

    @Test func missingReleasePreserves404() async throws {
        await #expect(throws: PanelAPIError.server(code: "NOT_FOUND", message: "No release recorded", httpStatus: 404)) {
            _ = try await api(ReleaseStub(try fixture("missing"), status: 404)).latest()
        }
    }

    @Test(arguments: [
        #"{"app":"other","build":123,"updatedAt":"2026-10-30T12:00:00Z"}"#,
        #"{"app":"panel","build":0,"updatedAt":"2026-10-30T12:00:00Z"}"#,
        #"{"app":"panel","build":-1,"updatedAt":"2026-10-30T12:00:00Z"}"#,
        #"{"app":"panel","build":1.5,"updatedAt":"2026-10-30T12:00:00Z"}"#,
        #"{"app":"panel","build":"123","updatedAt":"2026-10-30T12:00:00Z"}"#,
        #"{"app":"panel","build":123,"updatedAt":"bad"}"#,
        #"{"app":"panel","build":123}"#
    ]) func rejectsMalformedReleases(_ json: String) async {
        await #expect(throws: PanelAPIError.self) {
            _ = try await api(ReleaseStub(Data("{\"result\":{\"data\":\(json)}}".utf8))).latest()
        }
    }

    @Test func errorsDoNotInventARelease() async throws {
        await #expect(throws: PanelAPIError.http(status: 503)) {
            _ = try await api(ReleaseStub(Data(), status: 503)).latest()
        }
        await #expect(throws: PanelAPIError.self) {
            _ = try await api(ReleaseStub(Data("<html>Access login</html>".utf8))).latest()
        }
    }

    private func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/releases")))
    }
    private func api(_ transport: ReleaseStub) -> ReleasesAPI {
        ReleasesAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!, accessClientID: "synthetic-id",
            accessClientSecret: "synthetic-secret"), transport: transport))
    }
}

private actor ReleaseStub: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    init(_ data: Data, status: Int = 200) { self.data = data; self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
