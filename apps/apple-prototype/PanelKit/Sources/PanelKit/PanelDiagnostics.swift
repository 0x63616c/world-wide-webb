import Foundation

/// Process-local only. Never retain headers, URLs, free text, or string payload values.
public final class PanelCommandLog: @unchecked Sendable {
    public static let shared = PanelCommandLog()
    public static let failureNotification = Notification.Name("PanelCommandFailed")
    public static let changedNotification = Notification.Name("PanelCommandLogChanged")
    public struct Entry: Codable, Sendable, Equatable, Identifiable {
        public let id = UUID()
        enum CodingKeys: String, CodingKey { case control, payload, status, error, latencyMs }
        public let control: String
        public let payload: [String: String]
        public let status: Int?
        public let error: String?
        public let latencyMs: Int
    }
    private let lock = NSLock()
    private var entries: [Entry] = []
    public init() {}
    public func snapshot() -> [Entry] {
        lock.lock(); defer { lock.unlock() }
        return entries
    }
    public func record(control: String, input: Data? = nil, status: Int? = nil,
                       error: String? = nil, latencyMs: Int = 0) {
        // Only known control fields survive; values that could identify people,
        // rooms, credentials, alarm labels, or media are never retained.
        let allowed: Set<String> = ["value", "pct", "seconds", "positionSeconds", "key", "on", "enabled", "brightness", "kelvin", "temperature", "target", "low", "high", "volume", "position", "mode", "speed", "color", "id", "roomId", "entityId"]
        var payload: [String: String] = [:]
        if let input, let object = try? JSONSerialization.jsonObject(with: input, options: [.fragmentsAllowed]) {
            if let fields = object as? [String: Any] {
                for (key, value) in fields where allowed.contains(key) {
                    payload[key] = (value as? NSNumber)?.stringValue ?? "<redacted>"
                }
            } else {
                payload["value"] = (object as? NSNumber)?.stringValue ?? "<redacted>"
            }
        }
        let safeControl = !control.isEmpty && control.count <= 80 && control.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "._".contains($0)) } ? control : "command"
        let safeError = error.map { ["dropped: module not live", "dropped: action unavailable", "cancelled", "request failed"].contains($0) ? $0 : "request failed" }
        let entry = Entry(control: safeControl, payload: payload, status: status,
                          error: safeError, latencyMs: max(0, min(latencyMs, 300_000)))
        lock.lock()
        entries.append(entry)
        if entries.count > 50 { entries.removeFirst(entries.count - 50) }
        lock.unlock()
        Foundation.NotificationCenter.default.post(name: Self.changedNotification, object: nil)
        if safeError != nil && safeError != "cancelled" {
            Foundation.NotificationCenter.default.post(name: Self.failureNotification, object: nil)
        }
    }
}

public struct PanelDiagnosticsSnapshot: Codable, Sendable {
    public let source: String
    public let backendURL: String
    public let build: String
    public let gitSHA: String
    public let backend: String
    public let latencyMs: Int?
    public let homeAssistant: String
    public init(source: String, backendURL: String, build: String, gitSHA: String,
                backend: String, latencyMs: Int?, homeAssistant: String) {
        self.source = source; self.backendURL = backendURL; self.build = build; self.gitSHA = gitSHA
        self.backend = backend; self.latencyMs = latencyMs; self.homeAssistant = homeAssistant
    }
}
public struct PanelDiagnosticsSubmission: Encodable, Sendable {
    public let snapshot: PanelDiagnosticsSnapshot
    public let commands: [PanelCommandLog.Entry]
    public init(snapshot: PanelDiagnosticsSnapshot, commands: [PanelCommandLog.Entry]) {
        self.snapshot = snapshot; self.commands = Array(commands.suffix(50))
    }
}
