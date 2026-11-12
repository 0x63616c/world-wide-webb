import Foundation
import Testing

@testable import PanelKit

@Suite struct ProfilesAPITests {
    @Test func createEditAndDeleteUseSharedResource() async throws {
        let transport = ProfileTransport()
        let api = ProfilesAPI(client: PanelAPIClient(
            configuration: PanelConfiguration(baseURL: URL(string: "https://fixtures.example.invalid")!),
            transport: transport))
        #expect(try await api.list().isEmpty)
        let photo = Data([0xff, 0xd8, 0xff])
        let created = try await api.create(name: "Ada", photo: photo, pin: "123456")
        #expect(created.photo == photo)
        #expect(try await api.list().map(\.name) == ["Ada"])
        let updated = try await api.update(created.id, name: "Avery", photo: photo, pin: "123456")
        #expect(updated.name == "Avery")
        try await api.remove(created.id, pin: "123456")
        #expect(try await api.list().isEmpty)
        let requests = await transport.requests
        #expect(requests.map(\.httpMethod) == ["GET", "POST", "GET", "PATCH", "DELETE", "GET"])
        let deletion = try #require(requests.first { $0.httpMethod == "DELETE" })
        let body = try JSONDecoder().decode([String: String].self, from: #require(deletion.httpBody))
        #expect(body == ["pin": "123456"])
    }
}

private actor ProfileTransport: PanelTransport {
    private(set) var requests: [URLRequest] = []
    private var profile: PanelProfile?

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let data: Data
        switch request.httpMethod {
        case "POST", "PATCH":
            struct Input: Decodable { let pin: String; let name: String; let photo: Data }
            let input = try JSONDecoder().decode(Input.self, from: #require(request.httpBody))
            #expect(input.pin == "123456")
            profile = PanelProfile(id: "profile_1", name: input.name, photo: input.photo)
            data = try JSONEncoder().encode(profile)
        case "DELETE":
            profile = nil
            data = Data(#"{"deleted":true}"#.utf8)
        default:
            data = try JSONEncoder().encode(profile.map { [$0] } ?? [])
        }
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
