import Foundation
import Testing
@testable import PanelKit

@Suite struct PanelPINAPITests {
    private func api(_ transport: PINTransport) -> PanelPINAPI {
        PanelPINAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://fixtures.example.invalid")!), transport: transport))
    }
    @Test func changesOnlyAfterCurrentPINVerifiedAndUsesPOST() async throws {
        let transport = PINTransport()
        let service = api(transport)
        try await service.change(current: "135790", replacement: "024680")
        #expect(try await service.verify("024680"))
        #expect(try await !service.verify("135790"))
        let requests = await transport.requests
        let mutation = try #require(requests.first { $0.httpMethod == "POST" })
        #expect(mutation.url?.lastPathComponent == "settings.set")
        #expect(mutation.url?.query == nil)
        let patch = try JSONDecoder().decode([String: String].self, from: #require(mutation.httpBody))
        #expect(Set(patch.keys) == ["pinCode"])
        #expect(requests.filter { $0.httpMethod == "POST" }.count == 1)
    }
    @Test func wrongCurrentPINCannotWrite() async throws {
        let transport = PINTransport()
        await #expect(throws: PanelPINAPI.Failure.incorrectCurrentPIN) {
            try await api(transport).change(current: "999999", replacement: "024680")
        }
        #expect(await transport.requests.allSatisfy { $0.httpMethod == "GET" })
    }
    @Test func rejectsMalformedDigitsBeforeNetworking() async throws {
        let transport = PINTransport()
        let service = api(transport)
        for invalid in ["12345", "1234567", "１２３４５６", "12 456", "abcdef"] {
            #expect(try await !service.verify(invalid))
            await #expect(throws: PanelPINAPI.Failure.invalidFormat) {
                try await service.change(current: "135790", replacement: invalid)
            }
        }
        #expect(await transport.requests.isEmpty)
    }
}

private actor PINTransport: PanelTransport {
    private var pin = "135790" // Synthetic test data only.
    private(set) var requests: [URLRequest] = []
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        if request.httpMethod == "POST" {
            pin = try JSONDecoder().decode([String: String].self, from: #require(request.httpBody))["pinCode"]!
        }
        let data = try JSONSerialization.data(withJSONObject: ["result": ["data": ["pinCode": pin]]])
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
