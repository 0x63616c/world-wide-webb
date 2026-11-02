import Foundation
import PanelKit
import XCTest
@testable import WorldWideWebb

@MainActor final class LiveWifiProviderTests: XCTestCase {
    func testFixturesMapToExistingStateAndRoundTripQRCode() throws {
        for name in ["wpa", "open", "unconfigured", "escaped"] {
            let response = try fixture(name)
            let state = try LiveWifiProvider.parse(response)
            XCTAssertEqual(WifiQRCode.payload(for: state) ?? "", response)
            switch name {
            case "wpa":
                XCTAssertEqual(state.ssid, "Example Guest")
                XCTAssertEqual(state.password, "fake-password-123")
            case "open":
                XCTAssertEqual(state.ssid, "Example Open")
                XCTAssertNil(state.password)
            case "unconfigured":
                XCTAssertNil(state.ssid)
                XCTAssertNil(state.password)
            default:
                XCTAssertEqual(state.ssid, #"Example\;,:" Guest"#)
                XCTAssertEqual(state.password, #"fake\;,:"password"#)
            }
        }
    }

    func testMalformedPayloadsFailClosed() {
        for payload in ["garbage", "WIFI:T:WPA;S:Guest;;", "WIFI:T:WPA;S:;P:fake;;",
                        "WIFI:T:WEP;S:Guest;P:fake;;", "WIFI:T:WPA;S:Guest;S:Other;P:fake;;",
                        #"WIFI:T:WPA;S:Guest\q;P:fake;;"#, "WIFI:T:nopass;S:Guest;P:fake;;",
                        "WIFI:T:WPA;S:Guest;P:fake;", #"WIFI:T:WPA;S:Guest;P:fake\;;"#] {
            XCTAssertThrowsError(try LiveWifiProvider.parse(payload))
        }
    }

    func testExplicitRefreshMapsFixturesAndUnconfiguredClearsCredentials() async throws {
        let transport = WifiProviderTransport(replies: try ["wpa", "open", "escaped", "unconfigured"].map(fixture))
        let provider = makeProvider(transport)
        XCTAssertNil(provider.qrPayload)
        XCTAssertNil(provider.wifi.ssid)
        XCTAssertEqual(provider.availability, .loading)
        let initialCount = await transport.count
        XCTAssertEqual(initialCount, 0)
        for name in ["wpa", "open", "escaped", "unconfigured"] {
            await provider.refresh()
            XCTAssertEqual(provider.availability, .live)
            XCTAssertEqual(WifiQRCode.payload(for: provider.wifi) ?? "", try fixture(name))
            XCTAssertEqual(provider.qrPayload, name == "unconfigured" ? nil : try fixture(name))
        }
    }

    func testFailureClearsCredentialsAndRecoverySucceeds() async throws {
        let transport = WifiProviderTransport(replies: [try fixture("wpa"), nil, "invalid", try fixture("open")])
        let provider = makeProvider(transport)
        await provider.refresh()
        XCTAssertNotNil(provider.wifi.password)
        for reason in ["Can't reach server", "Guest Wi-Fi is unavailable."] {
            await provider.refresh()
            XCTAssertNil(provider.wifi.ssid)
            XCTAssertNil(provider.wifi.password)
            XCTAssertNil(provider.qrPayload)
            XCTAssertEqual(provider.availability, .unavailable(reason))
        }
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertEqual(provider.wifi.ssid, "Example Open")
        XCTAssertNil(provider.wifi.password)
    }

    func testCancelledRefreshDoesNotPublishCredentials() async throws {
        let provider = makeProvider(WifiProviderTransport(replies: [try fixture("wpa")]))
        let task = Task { await provider.refresh() }
        task.cancel()
        await task.value
        XCTAssertNil(provider.wifi.ssid)
        XCTAssertNil(provider.wifi.password)
    }

    func testStopClearsCredentialsAndRejectsInFlightResponse() async throws {
        let transport = WifiProviderTransport(replies: try [fixture("wpa"), fixture("open")], delay: .milliseconds(40))
        let provider = makeProvider(transport)
        let task = Task { await provider.refresh() }
        while await transport.count == 0 { await Task.yield() }
        provider.stop()
        await task.value
        XCTAssertNil(provider.qrPayload)
        XCTAssertNil(provider.wifi.ssid)
        XCTAssertNil(provider.wifi.password)
        XCTAssertEqual(provider.availability, .loading)
        await provider.refresh()
        XCTAssertEqual(provider.availability, .live)
        XCTAssertNotNil(provider.qrPayload)
        provider.stop()
        XCTAssertNil(provider.qrPayload)
        XCTAssertNil(provider.wifi.ssid)
    }

    func testMockProviderRemainsOffline() async {
        let provider = MockWifiProvider(wifi: .open)
        await provider.refresh()
        XCTAssertEqual(provider.wifi.ssid, WifiState.open.ssid)
        XCTAssertNil(provider.wifi.password)
        XCTAssertEqual(provider.availability, .live)
    }

    private func makeProvider(_ transport: WifiProviderTransport) -> LiveWifiProvider {
        LiveWifiProvider(api: WifiAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://panel.example.invalid")!
        ), transport: transport)))
    }

    private func fixture(_ name: String) throws -> String {
        // Xcode does not bundle SwiftPM test resources into the app test target.
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let url = root.appendingPathComponent("PanelKit/Tests/PanelKitTests/Fixtures/wifi/\(name).json")
        struct Envelope: Decodable {
            struct Result: Decodable { struct Payload: Decodable { let qr: String }; let data: Payload }
            let result: Result
        }
        return try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: url)).result.data.qr
    }
}

private actor WifiProviderTransport: PanelTransport {
    let replies: [String?]
    private(set) var count = 0
    let delay: Duration
    init(replies: [String?], delay: Duration = .zero) { self.replies = replies; self.delay = delay }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let index = count
        count += 1
        try await Task.sleep(for: delay)
        guard replies.indices.contains(index), let qr = replies[index] else { throw URLError(.notConnectedToInternet) }
        let data = try JSONSerialization.data(withJSONObject: ["result": ["data": ["qr": qr]]])
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
