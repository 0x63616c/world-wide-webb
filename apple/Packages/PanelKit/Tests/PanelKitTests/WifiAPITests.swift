import Foundation
import XCTest

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

final class WifiAPITests: XCTestCase {
    func testGuestQrFixturesAndQueryContract() async throws {
        for name in ["wpa", "open", "unconfigured", "escaped"] {
            let url = try XCTUnwrap(
                Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/wifi"))
            let data = try Data(contentsOf: url)
            let transport = WifiFixtureTransport(data: data)
            let api = WifiAPI(
                client: PanelAPIClient(
                    configuration: PanelConfiguration(
                        baseURL: URL(string: "https://panel.example.invalid")!
                    ), transport: transport))
            let result = try await api.guestQr()
            let expected = try JSONDecoder().decode(GuestWifiQR.self, from: data)
            XCTAssertEqual(result.qr, expected.qr)
            let captured = await transport.captured()
            let request = try XCTUnwrap(captured)
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/v1/wifi/guest")
            XCTAssertNil(request.url?.query)
            XCTAssertNil(request.httpBody)
        }
    }
}

private actor WifiFixtureTransport: PanelTransport {
    let data: Data
    private var request: URLRequest?
    init(data: Data) { self.data = data }
    func captured() -> URLRequest? { request }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
