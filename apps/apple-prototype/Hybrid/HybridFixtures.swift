#if DEBUG
import Foundation
import PanelKit
import Observation

/// Explicit debug harness: exercises the real decoders/providers with their
/// existing synthetic fixtures. No URLSession fallback or credentials.
/// Writes require the explicit controlWrites fixture mode.
@MainActor @Observable final class HybridControlWriteTrace {
    static let shared = HybridControlWriteTrace()
    var value = "0:none"
}

actor HybridFixtureTransport: PanelTransport {
    private let root: URL
    private let unavailable: Bool
    private let alarmScenario: String
    private let sonosPlayback: Bool
    private let fanOffSupported: Bool
    private let controlWrites: Bool
    private var writeCount = 0
    private var controlState: [String: Any]?
    private var climateState: [String: Any]?
    private let climateOff: Bool
    private let walkActive: Bool
    private var overrides: [String: String] = [:]
    private(set) var requests: [URLRequest] = []

    init(root: URL, unavailable: Bool = false, alarmScenario: String = "scheduled", walkActive: Bool = false, sonosPlayback: Bool = false, climateOff: Bool = false, controlWrites: Bool = false, fanOffSupported: Bool = false) {
        self.fanOffSupported = fanOffSupported
        self.controlWrites = controlWrites
        self.sonosPlayback = sonosPlayback
        self.climateOff = climateOff
        self.walkActive = walkActive
        self.alarmScenario = alarmScenario
        self.root = root
        self.unavailable = unavailable
    }

    func setFixture(_ file: String, for procedure: String) { overrides[procedure] = file }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !unavailable, let url = request.url else { throw URLError(.notConnectedToInternet) }
        if url.path.hasPrefix("/media/"), !url.path.hasPrefix("/media/cameras/") {
            let data = try Data(contentsOf: root.appendingPathComponent("photos/image.png"))
            return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "image/png"])!)
        }
        let procedure = url.lastPathComponent
        if controlWrites, let data = try controlResponse(request, procedure: procedure) {
            if request.httpBody != nil {
                let trace = "\(writeCount):\(procedure)"
                await MainActor.run { HybridControlWriteTrace.shared.value = trace }
            }
            return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let file: String
        if let override = overrides[procedure] { file = override }
        else {
            switch procedure {
            case "settings.get": file = "photos/settings.json"
            case "boothPhotos.list": file = "photos/booth.json"
            case "wakePhotos.list": file = "photos/wakes.json"
            case "sessions.list": file = "photos/sessions.json"
            case "cameras.list": file = "cameras/list.json"
            case "snapshot" where url.path.hasPrefix("/media/cameras/camera."): file = "cameras/snapshot.png"
            case "alarms.list": file = "alarms/\(alarmScenario).json"
            case "tesla.state": file = "tesla/ready.json"
            case "controls.list": file = "all-on.json"
            case "climate.get": file = climateOff ? "climate/off.json" : "climate/cool.json"
            case "wifi.guestQr": file = "wifi/hybrid.json"
            case "weather.now": file = "weather/now.json"
            case "weather.hourly": file = "weather/hourly.json"
            case "sound.soundSystem": file = sonosPlayback ? "sonos/playback.json" : "sonos/rooms.json"
            case "walks.state": file = walkActive ? "walks/state-active.json" : "walks/state-idle.json"
            case "walks.history": file = "walks/hybrid-history.json"
            default: throw URLError(.unsupportedURL)
            }
        }
        // Unknown writes fail closed. Tests may explicitly supply an existing
        // acknowledgement fixture to inspect command routing without networking.
        let data = try Data(contentsOf: root.appendingPathComponent(file))
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: file.hasSuffix(".png") ? ["Content-Type": "image/png"] : nil)!)
    }

    /// Explicit UI-test backend for controls. Normal fixtures still reject writes.
    private func controlResponse(_ request: URLRequest, procedure: String) throws -> Data? {
        guard ["controls.list", "controls.toggle", "controls.setLampBrightness", "controls.setWhiteKelvin", "controls.setLampScene", "controls.setLampColor", "controls.setLampMode", "controls.setFanMode", "climate.get", "climate.setTarget", "climate.setMode", "climate.setRange"].contains(procedure) else { return nil }
        let isClimate = procedure.hasPrefix("climate.")
        let file = isClimate ? (climateOff ? "climate/off.json" : "climate/cool.json") : "all-on.json"
        let initial = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(file))) as! [String: Any]
        var envelope = (isClimate ? climateState : controlState) ?? initial
        var result = envelope["result"] as! [String: Any]
        var state = result["data"] as! [String: Any]
        if !isClimate {
            var fan = state["fan"] as! [String: Any]
            fan["modes"] = fanOffSupported ? ["off", "auto", "on"] : ["auto", "on"]
            if fan["mode"] == nil { fan["mode"] = (fan["on"] as? Bool) == true ? "on" : "auto" }
            state["fan"] = fan
        }
        if let body = request.httpBody {
            writeCount += 1
            let input = try JSONSerialization.jsonObject(with: body, options: .fragmentsAllowed)
            if procedure == "controls.toggle", let input = input as? [String: Any],
               let key = input["key"] as? String, let on = input["on"] as? Bool {
                var group = state[key] as! [String: Any]
                group["on"] = on
                if key == "fan" { group["sub"] = on ? "On" : climateOff ? "Off" : "Auto"; group["mode"] = on ? "on" : "auto" }
                state[key] = group
            } else if procedure == "controls.setFanMode", let input = input as? [String: String], let mode = input["mode"] {
                var fan = state["fan"] as! [String: Any]
                fan["on"] = mode == "on"; fan["mode"] = mode; fan["sub"] = mode.capitalized
                state["fan"] = fan
            } else if procedure == "controls.setWhiteKelvin", let input = input as? [String: Int] {
                var lamps = state["lamps"] as! [String: Any]; lamps["whiteKelvin"] = input["kelvin"]; state["lamps"] = lamps
            } else if procedure == "controls.setLampScene", let input = input as? [String: String] {
                var lamps = state["lamps"] as! [String: Any]; lamps["activeScene"] = input["scene"]; state["lamps"] = lamps
            } else if procedure == "climate.setMode", let mode = input as? String {
                state["mode"] = mode
                if mode == "heat_cool" { state["targetLow"] = 67; state["targetHigh"] = 73 }
                if mode == "off" { state["targetLow"] = NSNull(); state["targetHigh"] = NSNull() }
            } else if procedure == "climate.setRange", let input = input as? [String: Int] {
                state["mode"] = "heat_cool"; state["targetLow"] = input["low"]; state["targetHigh"] = input["high"]
            } else if procedure == "controls.setLampBrightness", let input = input as? [String: Int] {
                var lamps = state["lamps"] as! [String: Any]
                lamps["brightness"] = input["pct"]
                state["lamps"] = lamps
            } else if procedure == "climate.setTarget", let target = input as? Int {
                state["target"] = target
            }
        }
        result["data"] = state
        envelope["result"] = result
        if isClimate { climateState = envelope } else { controlState = envelope }
        return try JSONSerialization.data(withJSONObject: envelope)
    }

}
@MainActor final class HybridRemindersFixture: RemindersServing {
    let unavailable: Bool
    init(unavailable: Bool) { self.unavailable = unavailable }
    func list() async throws -> [PanelReminder] {
        if unavailable { throw URLError(.notConnectedToInternet) }
        return [.init(id: "fixture_reminder", title: "Water the plants", list: "Demo list", writable: true)]
    }
    func complete(id: String) async throws { throw URLError(.unsupportedURL) }
    func add(title: String) async throws { throw URLError(.unsupportedURL) }
}
#endif
