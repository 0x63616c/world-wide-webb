import Foundation
import Testing

@testable import PanelKit

@Suite struct RESTMigrationTests {
    private let token = "fixture-private-native-token-32-bytes"
    private func client(_ transport: RESTStub) -> PanelAPIClient {
        PanelAPIClient(
            configuration: PanelConfiguration(
                baseURL: URL(string: "https://example.invalid")!,
                accessClientID: "fixture-id", accessClientSecret: "fixture-secret", apiToken: token),
            transport: transport)
    }
    @Test func authenticatesRESTAndEncodesFlatQueryParameters() async throws {
        let stub = RESTStub(#"{"walks":[]}"#)
        _ = try await WalksAPI(client: client(stub)).history(
            limit: 20,
            before: Date(timeIntervalSince1970: 1_800_000_000))
        let request = try #require(await stub.requests.first)
        #expect(request.url?.path == "/api/v1/walks/history")
        #expect(request.url?.query?.contains("input=") == false)
        #expect(request.httpBody == nil)
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(query.first { $0.name == "limit" }?.value == "20")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + token)
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "fixture-secret")
    }
    @Test func pinVerificationUsesOnlyPOSTAndNeverDownloadsPIN() async throws {
        let stub = RESTStub(#"{"verified":false}"#)
        #expect(try await !PanelPINAPI(client: client(stub)).verify("123456"))
        let request = try #require(await stub.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/v1/settings/pin/verify")
        #expect(request.url?.query == nil)
        let body = try JSONDecoder().decode([String: String].self, from: #require(request.httpBody))
        #expect(body == ["pin": "123456"])
    }
    @Test func climateAndAlarmMutationsUseRESTBodies() async throws {
        let climate = RESTStub(
            #"{"mode":"off","ambient":70,"action":"Idle","target":null,"targetLow":null,"targetHigh":null}"#)
        _ = try await ClimateAPI(client: client(climate)).setMode(.off)
        let request = try #require(await climate.requests.first)
        #expect(request.httpMethod == "PATCH" && request.url?.path == "/api/v1/climate")
        #expect(try JSONDecoder().decode([String: String].self, from: #require(request.httpBody)) == ["mode": "off"])
        let alarm = RESTStub(#"{"id":"alm_fixture"}"#)
        try await AlarmsAPI(client: client(alarm)).stop(id: "alr_fixture", version: 3)
        let action = try #require(await alarm.requests.first)
        #expect(action.url?.path == "/api/v1/alarms/action")
        let body = try JSONSerialization.jsonObject(with: #require(action.httpBody)) as! [String: Any]
        #expect(body["action"] as? String == "stop")
        #expect(body["version"] as? Int == 3)
    }
    @Test func sonosCommandsAndMediaCarryAuthentication() async throws {
        let stub = RESTStub("null")
        let api = SonosAPI(
            configuration: PanelConfiguration(baseURL: URL(string: "https://example.invalid")!, apiToken: token),
            transport: stub)
        try await api.setVolume(deviceIp: "media_player.desk", volume: 42)
        let request = try #require(await stub.requests.first)
        #expect(request.url?.path == "/api/v1/sound")
        let command = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
        #expect(command["action"] as? String == "volume")
        #expect(command["room"] as? String == "media_player.desk")
        let photo = RESTStub("image", mime: "image/jpeg")
        _ = try await client(photo).photoData(collection: "booth-photos", path: "2026/bp_fixture.jpg")
        #expect(await photo.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer " + token)
    }
    @Test func unauthorizedAndFailedMutationsAreNotRetried() async throws {
        let stub = RESTStub(#"{"error":"Unauthorized"}"#, status: 401)
        do {
            _ = try await client(stub).post("walks/start", input: [String: String](), as: WalksState.self)
            Issue.record("Expected rejection")
        } catch let error as PanelAPIError {
            #expect(error == .server(code: "UNAUTHORIZED", message: "Unauthorized", httpStatus: 401))
        }
        #expect(await stub.requests.count == 1)
    }
    @Test func enrollmentRequiresSecureEndpointAndRedactsCredentials() async throws {
        let raw =
            #"{"baseURL":"https://api.example.invalid","apiToken":"fixture-private-native-token-32-bytes","accessClientID":"fixture-id","accessClientSecret":"fixture-secret"}"#
        let enrollment = try PanelEnrollment.parse(raw)
        for text in [enrollment.description, enrollment.debugDescription, String(reflecting: enrollment)] {
            #expect(!text.contains(token) && !text.contains("fixture-secret"))
        }
        #expect(throws: PanelAPIError.self) {
            try PanelEnrollment.parse(raw.replacingOccurrences(of: "https://", with: "http://"))
        }
        let stub = RESTStub(#"{"serverNow":"2026-11-07T00:00:00Z"}"#)
        try await enrollment.verify(transport: stub)
        #expect(await stub.requests.first?.url?.path == "/api/v1/alarms")
    }
}
private actor RESTStub: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    let mime: String
    init(_ json: String, status: Int = 200, mime: String = "application/json") {
        data = Data(json.utf8)
        self.status = status
        self.mime = mime
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (
            data,
            HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": mime])!
        )
    }
}
