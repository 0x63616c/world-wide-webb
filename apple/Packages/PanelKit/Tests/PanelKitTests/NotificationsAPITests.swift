import Foundation
import Testing

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

@Suite struct NotificationsAPITests {
    @Test func exactShapeAndAccessTransport() async throws {
        let data = try Data(
            contentsOf: #require(
                Bundle.module.url(forResource: "page", withExtension: "json", subdirectory: "Fixtures/notifications")))
        let stub = NotificationTransport(data)
        let page = try await api(stub).list()
        #expect(page.cursor == "9223372036854775806")
        #expect(page.items.first?.sourceModule == "alarms")
        #expect(page.items.first?.priority == .high)
        #expect(page.items.first?.readAt == nil)
        #expect(page.items.first?.dedupeKey == "morning")
        let request = try #require(await stub.requests.first)
        #expect(request.url?.path == "/api/v1/notifications")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == nil)
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == nil)
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(query.first { $0.name == "limit" }?.value == "200")
        #expect(!query.contains { $0.name == "unread" })
    }

    @Test func exactMutationBodies() async throws {
        let page = try Data(
            contentsOf: #require(
                Bundle.module.url(forResource: "page", withExtension: "json", subdirectory: "Fixtures/notifications")))
        let json = try #require(JSONSerialization.jsonObject(with: page) as? [String: Any])
        let payload = json
        let row = (payload["items"] as! [[String: Any]])[0]
        let stub = NotificationTransport(try JSONSerialization.data(withJSONObject: row))
        _ = try await api(stub).markRead(id: "ntf_synthetic")
        _ = try await api(stub).dismiss(id: "ntf_synthetic")
        let requests = await stub.requests
        #expect(requests.map { $0.url!.lastPathComponent } == ["read", "dismiss"])
        for request in requests {
            #expect(request.httpMethod == "POST")
            #expect(
                try JSONSerialization.jsonObject(with: #require(request.httpBody)) as? [String: String] == [
                    "id": "ntf_synthetic"
                ])
        }
        let clear = NotificationTransport(Data(#"{"dismissed":3}"#.utf8))
        #expect(try await api(clear).dismissAll() == 3)
        #expect(await clear.requests.first?.url?.lastPathComponent == "dismiss-all")
    }

    @Test(arguments: ["", "-1", "01", "9223372036854775808", "1.0", "١"])
    func rejectsInvalidCursor(_ cursor: String) async {
        await #expect(throws: PanelAPIError.self) {
            _ = try await api(NotificationTransport(Data())).list(since: cursor)
        }
    }

    @Test(arguments: [
        #"{"items":[],"cursor":"2","has_more":true}"#,
        #"{"items":[],"cursor":"1","has_more":false}"#,
        #"{"items":[],"cursor":0,"has_more":false}"#,
        #"{"items":[],"cursor":"bad","has_more":false}"#,
    ]) func rejectsInvalidPages(_ payload: String) async {
        await #expect(throws: PanelAPIError.self) {
            _ = try await api(NotificationTransport(Data(payload.utf8))).list(since: "2")
        }
    }

    @Test func missingEndpointAndAccessHTMLFailClosed() async {
        for status in [404, 503] {
            await #expect(throws: PanelAPIError.self) {
                _ = try await api(NotificationTransport(Data(), status: status)).list()
            }
        }
        await #expect(throws: PanelAPIError.self) {
            _ = try await api(NotificationTransport(Data("<html>Access</html>".utf8))).list()
        }
    }

    private func api(_ transport: NotificationTransport) -> NotificationsAPI {
        NotificationsAPI(
            client: PanelAPIClient(
                configuration: PanelConfiguration(
                    baseURL: URL(string: "https://panel.example.invalid")!), transport: transport))
    }
}

private actor NotificationTransport: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    init(_ data: Data, status: Int = 200) {
        self.data = data
        self.status = status
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
