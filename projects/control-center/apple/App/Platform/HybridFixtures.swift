#if DEBUG
    import Foundation
    import PanelKit
    import Observation
    import UIKit

    /// Explicit simulator-only test images; never a fallback for a real camera.
    @MainActor final class BoothCaptureFixture {
        private var frame = 0
        func photo() throws -> Data {
            frame += 1
            if let root = Bundle.main.resourceURL?.appendingPathComponent("Fixtures"),
                let photo = BoothReviewFixture.image(root: root, index: (frame - 1) % 4)
            {
                return photo
            }
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            return UIGraphicsImageRenderer(size: CGSize(width: 800, height: 600), format: format)
                .jpegData(withCompressionQuality: 0.9) { context in
                    [UIColor.systemTeal, .systemOrange, .systemIndigo, .systemPink][(frame - 1) % 4].setFill()
                    context.fill(CGRect(x: 0, y: 0, width: 800, height: 600))
                    ("\(frame)" as NSString).draw(
                        at: CGPoint(x: 335, y: 160),
                        withAttributes: [
                            .font: UIFont.systemFont(ofSize: 180, weight: .semibold), .foregroundColor: UIColor.white,
                        ])
                    ("SIMULATOR TEST IMAGE" as NSString).draw(
                        at: CGPoint(x: 210, y: 445),
                        withAttributes: [
                            .font: UIFont.systemFont(ofSize: 30, weight: .medium), .foregroundColor: UIColor.white,
                        ])
                }
        }
    }

    /// Review captures use the regular camera/gallery views and their real image loaders.
    enum BoothReviewFixture {
        static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-hybridBoothLibrary") }

        static func image(root: URL, index: Int) -> Data? {
            guard enabled else { return nil }
            return try? Data(contentsOf: root.appendingPathComponent("photos/review/\(index).jpg"))
        }

        @MainActor static func preview(root: URL) -> UIImage? {
            image(root: root, index: 0).flatMap { UIImage(data: $0) }
        }

        static func gallery() throws -> Data {
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: .now)
            let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
            let earlier = calendar.date(from: DateComponents(year: 2025, month: 11, day: 2)) ?? yesterday
            let groups = [today, yesterday, earlier].enumerated().flatMap { day, date in
                (0..<(day == 2 ? 18 : 6)).map { index -> [String: Any] in
                    let id = "bp_review_\(day)_\(index)"
                    let captured = (date.timeIntervalSince1970 + Double(900 - index * 30)) * 1000
                    return [
                        "groupId": "bpg_\(id)", "mode": "photo", "capturedAt": captured,
                        "frames": [
                            [
                                "id": id, "path": "review-\((day + index) % 4).jpg",
                                "frameIdx": 0, "capturedAt": captured, "mimeType": "image/jpeg",
                            ]
                        ],
                    ]
                }
            }
            return try JSONSerialization.data(withJSONObject: [
                "groups": groups, "totalCount": groups.count, "totalBytes": 0,
            ])
        }
    }

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
        private var changedPIN: String?
        private var controlState: [String: Any]?
        private var climateState: [String: Any]?
        private let climateOff: Bool
        private var overrides: [String: String] = [:]
        private var boothCapture: Data?
        private(set) var requests: [URLRequest] = []

        init(
            root: URL, unavailable: Bool = false, alarmScenario: String = "scheduled",
            sonosPlayback: Bool = false, climateOff: Bool = false, controlWrites: Bool = false,
            fanOffSupported: Bool = false
        ) {
            self.fanOffSupported = fanOffSupported
            self.controlWrites = controlWrites
            self.sonosPlayback = sonosPlayback
            self.climateOff = climateOff
            self.alarmScenario = alarmScenario
            self.root = root
            self.unavailable = unavailable
        }

        func setFixture(_ file: String, for procedure: String) { overrides[procedure] = file }

        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            requests.append(request)
            guard !unavailable, let url = request.url else { throw URLError(.notConnectedToInternet) }
            if url.path == "/media/booth-photo", request.httpMethod == "POST" {
                guard ProcessInfo.processInfo.arguments.contains("-hybridBoothCamera"), let body = request.httpBody
                else {
                    throw URLError(.unsupportedURL)
                }
                boothCapture = body
                return (
                    Data(#"{"id":"bp_simulator","path":"simulator-strip.jpg"}"#.utf8),
                    HTTPURLResponse(url: url, statusCode: 201, httpVersion: nil, headerFields: nil)!
                )
            }
            if url.path == "/media/booth-photos/simulator-strip.jpg", let boothCapture {
                return (
                    boothCapture,
                    HTTPURLResponse(
                        url: url, statusCode: 200, httpVersion: nil,
                        headerFields: ["Content-Type": "image/jpeg"])!
                )
            }
            if url.path == "/api/v1/booth", let boothCapture {
                let captured = Date().timeIntervalSince1970 * 1000
                let group: [String: Any] = [
                    "groupId": "bpg_simulator", "mode": "photo", "capturedAt": captured,
                    "frames": [
                        [
                            "id": "bp_simulator", "path": "simulator-strip.jpg", "frameIdx": 0,
                            "capturedAt": captured, "mimeType": "image/jpeg",
                        ]
                    ],
                ]
                let data = try JSONSerialization.data(withJSONObject: [
                    "groups": [group], "totalCount": 1, "totalBytes": boothCapture.count,
                ])
                return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            if BoothReviewFixture.enabled {
                if url.path == "/api/v1/booth" {
                    return (
                        try BoothReviewFixture.gallery(),
                        HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
                    )
                }
                if url.lastPathComponent.hasPrefix("review-"),
                    let index = url.lastPathComponent.dropFirst(7).first?.wholeNumberValue,
                    let image = BoothReviewFixture.image(root: root, index: index)
                {
                    return (
                        image,
                        HTTPURLResponse(
                            url: url, statusCode: 200, httpVersion: nil,
                            headerFields: ["Content-Type": "image/jpeg"])!
                    )
                }
            }
            if url.path.hasPrefix("/media/") {
                let data = try Data(contentsOf: root.appendingPathComponent("photos/image.png"))
                return (
                    data,
                    HTTPURLResponse(
                        url: url, statusCode: 200, httpVersion: nil,
                        headerFields: ["Content-Type": "image/png"])!
                )
            }
            let procedure = try fixtureKey(request)
            if procedure == "settings.verify" || procedure == "settings.change" {
                let input = try JSONDecoder().decode([String: String].self, from: request.httpBody ?? Data())
                let expected = changedPIN ?? "135790"
                var payload: [String: Any]
                var status = 200
                if procedure == "settings.verify" {
                    payload = ["verified": input["pin"] == expected]
                } else if controlWrites, input["current"] == expected,
                    let replacement = input["replacement"], PanelPINAPI.isValid(replacement)
                {
                    changedPIN = replacement
                    payload = ["changed": true]
                } else {
                    status = 403
                    payload = ["error": "PIN not accepted"]
                }
                return (
                    try JSONSerialization.data(withJSONObject: payload),
                    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
                )
            }
            if controlWrites, let data = try controlResponse(request, procedure: procedure) {
                if request.httpBody != nil {
                    let trace = "\(writeCount):\(procedure)"
                    await MainActor.run { HybridControlWriteTrace.shared.value = trace }
                }
                return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            let file: String
            if let override = overrides[procedure] {
                file = override
            } else {
                switch procedure {
                case "settings.get": file = "photos/settings.json"
                case "boothPhotos.list" where ProcessInfo.processInfo.arguments.contains("-hybridBoothEmpty"):
                    file = "photos/empty-booth.json"
                case "boothPhotos.list":
                    file =
                        ProcessInfo.processInfo.arguments.contains("-hybridBoothBurst")
                        ? "photos/booth-burst.json" : "photos/booth.json"
                case "alarms.list": file = "alarms/\(alarmScenario).json"
                case "tesla.history": file = "tesla/history.json"
                case "tesla.state":
                    let scenario = UserDefaults.standard.string(forKey: "hybridTeslaScenario") ?? "ready"
                    let allowed = [
                        "ready", "parked", "unlocked", "charging", "driving", "update", "installing", "offline",
                        "no-power",
                    ]
                    file = "tesla/\(allowed.contains(scenario) ? scenario : "ready").json"
                case "controls.list": file = "all-on.json"
                case "climate.get": file = climateOff ? "climate/off.json" : "climate/cool.json"
                case "wifi.guestQr": file = "wifi/hybrid.json"
                case "weather.now": file = "weather/now.json"
                case "weather.hourly": file = "weather/hourly.json"
                case "sound.soundSystem": file = sonosPlayback ? "sonos/playback.json" : "sonos/rooms.json"
                default: throw URLError(.unsupportedURL)
                }
            }
            // Unknown writes fail closed. Tests may explicitly supply an existing
            // acknowledgement fixture to inspect command routing without networking.
            let data = try Data(contentsOf: root.appendingPathComponent(file))
            return (
                data,
                HTTPURLResponse(
                    url: url, statusCode: 200, httpVersion: nil,
                    headerFields: file.hasSuffix(".png") ? ["Content-Type": "image/png"] : nil)!
            )
        }

        private func fixtureKey(_ request: URLRequest) throws -> String {
            guard let path = request.url?.path else { throw URLError(.unsupportedURL) }
            let method = request.httpMethod ?? "GET"
            let reads = [
                "controls": "controls.list", "climate": "climate.get", "alarms": "alarms.list",
                "tesla": "tesla.state", "tesla/history": "tesla.history",
                "wifi/guest": "wifi.guestQr", "weather/now": "weather.now",
                "weather/hourly": "weather.hourly", "weather/daily": "weather.daily", "sound": "sound.soundSystem",
                "booth": "boothPhotos.list",
                "notifications": "notifications.list", "releases/latest": "releases.latest",
            ]
            guard let route = path.range(of: "/api/v1/") else { throw URLError(.unsupportedURL) }
            let resource = String(path[route.upperBound...])
            if method == "GET", let key = reads[resource] { return key }
            if resource == "settings/pin/verify" { return "settings.verify" }
            if resource == "settings/pin" { return "settings.change" }
            let input =
                (request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
            if resource == "controls", let action = input["action"] as? String {
                return [
                    "toggle": "controls.toggle", "scene": "controls.setLampScene", "color": "controls.setLampColor",
                    "whiteKelvin": "controls.setWhiteKelvin", "brightness": "controls.setLampBrightness",
                    "mode": "controls.setLampMode", "fan": "controls.setFanMode",
                ][action] ?? "unsupported"
            }
            if resource == "climate" {
                return input["mode"] != nil
                    ? "climate.setMode" : input["target"] != nil ? "climate.setTarget" : "climate.setRange"
            }
            if resource == "sound", let action = input["action"] as? String {
                return [
                    "volume": "sound.sonosSetVolume", "mute": "sound.sonosSetMute", "transport": "sound.sonosTransport",
                    "seek": "sound.sonosSeek", "join": "sound.sonosGroupJoinAll", "leave": "sound.sonosGroupLeave",
                    "source": "sound.sonosSetLineIn", "tv": "sound.sonosGroupJoinAllToTv",
                ][action] ?? "unsupported"
            }
            if resource == "sound/calibration" {
                return method == "DELETE" ? "sound.sonosClearCalibration" : "sound.sonosCalibrate"
            }
            if resource == "alarms" { return "alarms.create" }
            if resource == "alarms/action" { return "alarms." + (input["action"] as? String ?? "unsupported") }
            if resource.hasPrefix("alarms/") {
                return method == "DELETE"
                    ? "alarms.delete" : input["enabled"] != nil ? "alarms.setEnabled" : "alarms.update"
            }
            if resource.hasPrefix("booth/") {
                return resource.hasSuffix("/filter") ? "boothPhotos.clearFilter" : "boothPhotos.remove"
            }
            return "unsupported"
        }

        /// Explicit UI-test backend for controls. Normal fixtures still reject writes.
        private func controlResponse(_ request: URLRequest, procedure: String) throws -> Data? {
            guard
                [
                    "controls.list", "controls.toggle", "controls.setLampBrightness", "controls.setWhiteKelvin",
                    "controls.setLampScene", "controls.setLampColor", "controls.setLampMode", "controls.setFanMode",
                    "climate.get", "climate.setTarget", "climate.setMode", "climate.setRange",
                ].contains(procedure)
            else { return nil }
            let isClimate = procedure.hasPrefix("climate.")
            let file = isClimate ? (climateOff ? "climate/off.json" : "climate/cool.json") : "all-on.json"
            let initial =
                try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(file)))
                as! [String: Any]
            var state = (isClimate ? climateState : controlState) ?? initial
            if !isClimate {
                var fan = state["fan"] as! [String: Any]
                fan["modes"] = fanOffSupported ? ["off", "auto", "on"] : ["auto", "on"]
                if fan["mode"] == nil { fan["mode"] = (fan["on"] as? Bool) == true ? "on" : "auto" }
                state["fan"] = fan
            }
            if let body = request.httpBody {
                writeCount += 1
                var fields = try JSONSerialization.jsonObject(with: body) as! [String: Any]
                fields.removeValue(forKey: "action")
                let input: Any = fields
                if procedure == "controls.toggle", let input = input as? [String: Any],
                    let key = input["key"] as? String, let on = input["on"] as? Bool
                {
                    var group = state[key] as! [String: Any]
                    group["on"] = on
                    if key == "fan" {
                        group["sub"] = on ? "On" : climateOff ? "Off" : "Auto"
                        group["mode"] = on ? "on" : "auto"
                    }
                    state[key] = group
                } else if procedure == "controls.setFanMode", let input = input as? [String: String],
                    let mode = input["mode"]
                {
                    var fan = state["fan"] as! [String: Any]
                    fan["on"] = mode == "on"
                    fan["mode"] = mode
                    fan["sub"] = mode.capitalized
                    state["fan"] = fan
                } else if procedure == "controls.setWhiteKelvin", let input = input as? [String: Int] {
                    var lamps = state["lamps"] as! [String: Any]
                    lamps["whiteKelvin"] = input["kelvin"]
                    state["lamps"] = lamps
                } else if procedure == "controls.setLampScene", let input = input as? [String: String] {
                    var lamps = state["lamps"] as! [String: Any]
                    lamps["activeScene"] = input["scene"]
                    state["lamps"] = lamps
                } else if procedure == "climate.setMode", let mode = fields["mode"] as? String {
                    state["mode"] = mode
                    if mode == "heat_cool" {
                        state["targetLow"] = 67
                        state["targetHigh"] = 73
                    }
                    if mode == "off" {
                        state["targetLow"] = NSNull()
                        state["targetHigh"] = NSNull()
                    }
                } else if procedure == "climate.setRange", let input = input as? [String: Int] {
                    state["mode"] = "heat_cool"
                    state["targetLow"] = input["low"]
                    state["targetHigh"] = input["high"]
                } else if procedure == "controls.setLampBrightness", let input = input as? [String: Int] {
                    var lamps = state["lamps"] as! [String: Any]
                    lamps["brightness"] = input["pct"]
                    state["lamps"] = lamps
                } else if procedure == "climate.setTarget", let target = fields["target"] as? Int {
                    state["target"] = target
                }
            }
            if isClimate { climateState = state } else { controlState = state }
            return try JSONSerialization.data(withJSONObject: state)
        }

    }
#endif
