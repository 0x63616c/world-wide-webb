import Observation
import PanelKit

/// Fetch on demand. Never persists, logs, or includes a payload in an error.
@MainActor @Observable final class LiveWifiProvider {
    private(set) var wifi: WifiState = .unconfigured
    /// Original validated server payload, retained only while current credentials are usable.
    private(set) var qrPayload: String?
    private(set) var availability: LiveAvailability = .loading
    @ObservationIgnored private let api: WifiAPI
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0

    init(api: WifiAPI) { self.api = api }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        let requestGeneration = generation
        defer { if requestGeneration == generation { refreshing = false } }
        do {
            let response = try await api.guestQr()
            try Task.checkCancellation()
            guard requestGeneration == generation else { return }
            let parsed = try Self.parse(response.qr)
            apply(parsed, qr: parsed.ssid == nil ? nil : response.qr, availability: .live)
        } catch {
            guard requestGeneration == generation else { return }
            // Clear stale join credentials, including when the caller cancels.
            apply(
                .unconfigured, qr: nil,
                availability: .unavailable(panelFailureReason(error, fallback: "Guest Wi-Fi is unavailable.")))
        }
    }

    /// Polled: assign only changes so identical samples don't invalidate readers.
    private func apply(_ wifi: WifiState, qr: String?, availability: LiveAvailability) {
        if self.wifi != wifi { self.wifi = wifi }
        if qrPayload != qr { qrPayload = qr }
        if self.availability != availability { self.availability = availability }
    }

    /// Forget credentials on backgrounding and reject any response from the old scene.
    func stop() {
        generation += 1
        refreshing = false
        wifi = .unconfigured
        qrPayload = nil
        // A stopped scene has no usable credentials; the next foreground read
        // decides whether they are live or unavailable.
        availability = .loading
    }

    /// Split only on unescaped delimiters, then unescape exactly once. The server
    /// escapes backslash, semicolon, comma, colon and quote in both credential fields.
    static func parse(_ payload: String) throws -> WifiState {
        guard !payload.isEmpty else { return .unconfigured }
        guard payload.hasPrefix("WIFI:"), payload.hasSuffix(";;") else { throw PayloadError.invalid }
        var fields: [String: String] = [:]
        var key = ""
        var value = ""
        var inValue = false
        var escaped = false
        var ended = false
        for character in payload.dropFirst(5) {
            guard !ended else { throw PayloadError.invalid }
            if escaped {
                guard "\\;,:\"".contains(character), inValue else { throw PayloadError.invalid }
                value.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == ";" {
                if inValue {
                    guard fields[key] == nil else { throw PayloadError.invalid }
                    fields[key] = value
                } else {
                    guard key.isEmpty else { throw PayloadError.invalid }
                    ended = true
                }
                key = ""
                value = ""
                inValue = false
            } else if character == ":", !inValue {
                guard !key.isEmpty else { throw PayloadError.invalid }
                inValue = true
            } else if inValue {
                value.append(character)
            } else {
                key.append(character)
            }
        }
        guard ended, !escaped, key.isEmpty, !inValue,
            let ssid = fields["S"], !ssid.isEmpty
        else { throw PayloadError.invalid }
        switch fields["T"] {
        case "nopass":
            guard fields["P"] == nil || fields["P"] == "" else { throw PayloadError.invalid }
            return WifiState(ssid: ssid, password: nil)
        case "WPA":
            guard let password = fields["P"], !password.isEmpty else { throw PayloadError.invalid }
            return WifiState(ssid: ssid, password: password)
        default: throw PayloadError.invalid
        }
    }

    private enum PayloadError: Error { case invalid }
}
