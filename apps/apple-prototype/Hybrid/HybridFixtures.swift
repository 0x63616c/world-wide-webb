#if DEBUG
import Foundation
import PanelKit

/// Explicit debug harness: exercises the real decoders/providers with their
/// existing synthetic fixtures. No URLSession fallback, writes or credentials.
actor HybridFixtureTransport: PanelTransport {
    private let root: URL
    private let unavailable: Bool
    private var overrides: [String: String] = [:]
    private(set) var requests: [URLRequest] = []

    init(root: URL, unavailable: Bool = false) {
        self.root = root
        self.unavailable = unavailable
    }

    func setFixture(_ file: String, for procedure: String) { overrides[procedure] = file }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !unavailable, let url = request.url else { throw URLError(.notConnectedToInternet) }
        if url.path.hasPrefix("/media/") {
            let data = try Data(contentsOf: root.appendingPathComponent("photos/image.png"))
            return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "image/png"])!)
        }
        let procedure = url.lastPathComponent
        let file: String
        if let override = overrides[procedure] { file = override }
        else {
            switch procedure {
            case "settings.get": file = "photos/settings.json"
            case "boothPhotos.list": file = "photos/booth.json"
            case "wakePhotos.list": file = "photos/wakes.json"
            case "sessions.list": file = "photos/sessions.json"
            case "controls.list": file = "all-on.json"
            case "climate.get": file = "climate/cool.json"
            case "wifi.guestQr": file = "wifi/wpa.json"
            case "weather.now": file = "weather/now.json"
            case "weather.hourly": file = "weather/hourly.json"
            case "sound.soundSystem": file = "sonos/rooms.json"
            default: throw URLError(.unsupportedURL)
            }
        }
        // Unknown writes fail closed. Tests may explicitly supply an existing
        // acknowledgement fixture to inspect command routing without networking.
        let data = try Data(contentsOf: root.appendingPathComponent(file))
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
#endif
