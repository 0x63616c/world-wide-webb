import Foundation
import XCTest

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

final class WallSwitchesAPITests: XCTestCase {
    /// Body captured from the Rust server's `GET /api/v1/switches`.
    private let body = Data(
        #"""
        {"flips":[{"action":"Everything off","at":"2026-11-19T06:10:01.540000Z","gapMs":420,"gesture":"double","id":2,"state":"off","switch":"bedroom"},{"action":"Bedroom lamps on","at":"2026-11-19T06:10:01.120000Z","gapMs":null,"gesture":"single","id":1,"state":"on","switch":"bedroom"}],"settings":{"bedroomMode":"smart","bounceMs":150,"confirmBlink":false,"doubleAction":"apartmentToggle","frontDoorMode":"gestures","gestureWindowMs":600,"includeRelays":true,"nightBrightness":15,"nightEnd":"07:00","nightKelvin":2200,"nightStart":"22:00","smartAlarm":true,"smartNight":true,"smartParty":true,"tripleAction":"party"},"switches":[{"connected":false,"entity":null,"id":"bedroom","name":"Bedroom"},{"connected":true,"entity":"binary_sensor.overhead_lights_input_0","id":"frontDoor","name":"Front door"}]}
        """#.utf8)

    func testLoadDecodesServerSnapshotAndSaveSendsEverySetting() async throws {
        let transport = SwitchFixtureTransport(data: body)
        let api = WallSwitchesAPI(
            client: PanelAPIClient(
                configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!),
                transport: transport))
        let snapshot = try await api.load()
        XCTAssertEqual(snapshot.settings.bedroomMode, .smart)
        XCTAssertEqual(snapshot.flips.first?.gapMs, 420)
        XCTAssertNil(snapshot.flips.last?.gapMs)
        XCTAssertEqual(snapshot.switches.last?.connected, true)

        var changed = snapshot.settings
        changed.gestureWindowMs = 800
        _ = try await api.save(changed)
        let captured = await transport.captured()
        let request = try XCTUnwrap(captured)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/v1/switches")
        let sent = try XCTUnwrap(
            JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(sent["gestureWindowMs"] as? Int, 800)
        XCTAssertEqual(sent.count, 15)
    }
}

private actor SwitchFixtureTransport: PanelTransport {
    let data: Data
    private var request: URLRequest?
    init(data: Data) { self.data = data }
    func captured() -> URLRequest? { request }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
