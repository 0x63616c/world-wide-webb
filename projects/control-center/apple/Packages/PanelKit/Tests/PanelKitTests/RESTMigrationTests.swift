import Foundation
import Testing

@testable import PanelKit

@Suite struct RESTMigrationTests {
    private func client(_ transport: RESTStub) -> PanelAPIClient {
        PanelAPIClient(
            configuration: PanelConfiguration(
                baseURL: URL(string: "https://example.invalid")!),
            transport: transport)
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
    @Test func sonosCommandsAndMediaUsePrivateOrigin() async throws {
        let stub = RESTStub("null")
        let api = SonosAPI(
            configuration: PanelConfiguration(baseURL: URL(string: "https://example.invalid")!),
            transport: stub)
        try await api.setVolume(deviceIp: "media_player.desk", volume: 42)
        let request = try #require(await stub.requests.first)
        #expect(request.url?.path == "/api/v1/sound")
        let command = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
        #expect(command["action"] as? String == "volume")
        #expect(command["room"] as? String == "media_player.desk")
        let photo = RESTStub("image", mime: "image/jpeg")
        _ = try await client(photo).photoData(collection: "booth-photos", path: "2026/bp_fixture.jpg")
        #expect(await photo.requests.first?.value(forHTTPHeaderField: "Authorization") == nil)
    }
    @Test func unauthorizedAndFailedMutationsAreNotRetried() async throws {
        let stub = RESTStub(#"{"error":"Unauthorized"}"#, status: 401)
        do {
            _ = try await PanelPINAPI(client: client(stub)).verify("123456")
            Issue.record("Expected rejection")
        } catch let error as PanelAPIError {
            #expect(error == .server(code: "UNAUTHORIZED", message: "Unauthorized", httpStatus: 401))
        }
        #expect(await stub.requests.count == 1)
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
