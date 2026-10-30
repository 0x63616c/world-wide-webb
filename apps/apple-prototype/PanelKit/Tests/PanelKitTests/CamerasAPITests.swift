import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

@Suite struct CamerasAPITests {
    @Test func exactListContractAndAuthenticatedSnapshot() async throws {
        let transport = CameraAPIStub(data: try fixture("list", "json"))
        let api = makeAPI(transport)
        let rows = try await api.list()
        #expect(rows.map(\.id) == ["camera.test_a", "camera.test_b", "camera.test_offline"])
        #expect(rows.map(\.canSnapshot) == [true, true, false])
        let image = try fixture("snapshot", "png")
        await transport.set(data: image, type: "image/png")
        #expect(try await api.snapshot(id: rows[0].id) == image)
        let requests = await transport.requests
        #expect(requests.map { $0.url!.path } == ["/trpc/cameras.list", "/media/cameras/camera.test_a/snapshot"])
        for request in requests {
            #expect(request.httpMethod == "GET")
            #expect(request.url?.query == nil)
            #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == "fixture-id")
            #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "fixture-secret")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        }
    }

    @Test func emptyMissingAndMalformedList() async throws {
        let transport = CameraAPIStub(data: try fixture("empty", "json"))
        let api = makeAPI(transport)
        #expect(try await api.list().isEmpty)
        await transport.set(data: try fixture("missing", "json"), status: 404)
        await #expect(throws: PanelAPIError.self) { try await api.list() }
        for json in [#"{"result":{"data":[{"id":"camera.a","name":"A"}]}}"#,
                     #"{"result":{"data":[{"id":"https://elsewhere.test","name":"A","state":"idle"}]}}"#,
                     #"{"result":{"data":[{"id":"camera.a","name":"A","state":"idle"},{"id":"camera.a","name":"B","state":"idle"}]}}"#] {
            await transport.set(data: Data(json.utf8))
            await #expect(throws: PanelAPIError.self) { try await api.list() }
        }
    }

    @Test func invalidPathsNeverSendAndFailuresNeverReturnBodies() async throws {
        let transport = CameraAPIStub(data: Data("private upstream detail".utf8))
        let api = makeAPI(transport)
        for id in ["camera.a/b", "camera.a?token=x", "light.a", "camera.%2e%2e", "camera.a\n", "https://evil.test"] {
            await #expect(throws: PanelAPIError.self) { try await api.snapshot(id: id) }
        }
        #expect(await transport.requests.isEmpty)
        for status in [302, 401, 403, 404, 503] {
            await transport.set(data: Data("private upstream detail".utf8), status: status)
            await #expect(throws: PanelAPIError.http(status: status)) { try await api.snapshot(id: "camera.a") }
        }
        await transport.set(data: Data("<html>Access login</html>".utf8), type: "text/html")
        await #expect(throws: PanelAPIError.self) { try await api.snapshot(id: "camera.a") }
        await transport.set(data: Data(), type: "image/jpeg")
        await #expect(throws: PanelAPIError.self) { try await api.snapshot(id: "camera.a") }
    }

    @Test func noConfigurationAndPartialAccessPair() async throws {
        let transport = CameraAPIStub(data: try fixture("snapshot", "png"), type: "image/png")
        let absent = CamerasAPI(configuration: nil, transport: transport)
        await #expect(throws: PanelAPIError.notConfigured) { try await absent.snapshot(id: "camera.a") }
        #expect(await transport.requests.isEmpty)
        let api = CamerasAPI(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!,
                                                              accessClientID: "fixture-id"), transport: transport)
        _ = try await api.snapshot(id: "camera.a")
        #expect(await transport.requests.first?.value(forHTTPHeaderField: "CF-Access-Client-Id") == nil)
    }

    private func fixture(_ name: String, _ ext: String) throws -> Data {
        try Data(contentsOf: #require(Bundle.module.url(forResource: name, withExtension: ext, subdirectory: "Fixtures/cameras")))
    }
    private func makeAPI(_ transport: CameraAPIStub) -> CamerasAPI {
        CamerasAPI(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!,
            accessClientID: "fixture-id", accessClientSecret: "fixture-secret"), transport: transport)
    }
}

private actor CameraAPIStub: PanelTransport {
    var data: Data
    var status = 200
    var type: String
    private(set) var requests: [URLRequest] = []
    init(data: Data, type: String = "application/json") { self.data = data; self.type = type }
    func set(data: Data, status: Int = 200, type: String = "application/json") {
        self.data = data; self.status = status; self.type = type
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                      headerFields: ["Content-Type": type])!)
    }
}
