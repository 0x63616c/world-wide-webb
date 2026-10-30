import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

private actor TeslaAPITransport: PanelTransport {
    let data: Data
    private(set) var requests: [URLRequest] = []
    init(_ data: Data) { self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

@Suite struct TeslaAPITests {
    private func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: Bundle.module.resourceURL!.appendingPathComponent("Fixtures/tesla/\(name).json"))
    }
    private func api(_ transport: TeslaAPITransport) -> TeslaAPI {
        TeslaAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!,
            accessClientID: "fixture-id", accessClientSecret: "fixture-secret"), transport: transport))
    }
    @Test func decodesBackendFixtureAndUsesAuthenticatedGET() async throws {
        let transport = TeslaAPITransport(try fixture("ready"))
        guard case .ready(let data) = try await api(transport).state() else { Issue.record("Expected ready"); return }
        #expect(data.batteryPercent == 72 && data.rangeMiles == 200)
        #expect(data.chargingState == .charging && data.chargePowerKW == 7)
        #expect(data.locked && !data.climateOn && data.cabinFahrenheit == 68 && data.odometerMiles == 10000)
        let request = try #require(await transport.requests.first)
        #expect(request.httpMethod == "GET" && request.url?.path == "/trpc/tesla.state")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "fixture-secret")
    }
    @Test func absentAndUnavailableNeverDecodeAsData() async throws {
        #expect(try await api(TeslaAPITransport(fixture("unconfigured"))).state() == .unconfigured)
        #expect(try await api(TeslaAPITransport(fixture("unavailable"))).state() == .unavailable)
        await #expect(throws: PanelAPIError.self) { try await api(TeslaAPITransport(fixture("absent"))).state() }
    }
    @Test func rejectsMalformedTelemetryAndPartialState() async throws {
        let ready = try fixture("ready")
        let raw = String(decoding: ready, as: UTF8.self)
        for invalid in [
            raw.replacingOccurrences(of: "\"batteryPercent\": 72", with: "\"batteryPercent\": 101"),
            raw.replacingOccurrences(of: "\"rangeMiles\": 200", with: "\"rangeMiles\": null"),
            raw.replacingOccurrences(of: "\"charging\"", with: "\"future\""),
            raw.replacingOccurrences(of: "\"ready\"", with: "\"unavailable\""),
            #"{"result":{"data":{"status":"ready","data":null}}}"#
        ] {
            await #expect(throws: PanelAPIError.self) {
                try await api(TeslaAPITransport(Data(invalid.utf8))).state()
            }
        }
    }
    @Test func allCommandsRequirePINInPOSTBodyOnly() async throws {
        let transport = TeslaAPITransport(try fixture("accepted"))
        for action in TeslaAction.allCases { try await api(transport).command(action, pin: "123456") }
        let requests = await transport.requests
        #expect(requests.count == 6)
        for (request, action) in zip(requests, TeslaAction.allCases) {
            #expect(request.httpMethod == "POST" && request.url?.path == "/trpc/tesla.command")
            #expect(request.url?.query == nil)
            let body = try #require(request.httpBody)
            #expect(try JSONSerialization.jsonObject(with: body) as? [String: String] == ["action": action.rawValue, "pin": "123456"])
        }
        for invalid in ["", "12345", "１２３４５６", "abcdef"] {
            await #expect(throws: PanelAPIError.self) { try await api(transport).command(.unlock, pin: invalid) }
        }
        #expect(await transport.requests.count == 6)
        await #expect(throws: PanelAPIError.self) {
            try await api(TeslaAPITransport(fixture("forbidden"))).command(.unlock, pin: "123456")
        }
    }
}
