import Foundation

public struct CallingApp: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
    public static let supported = [
        Self(id: "com.apple.FaceTime", name: "FaceTime"),
        Self(id: "us.zoom.xos", name: "Zoom"),
        Self(id: "com.microsoft.teams2", name: "Microsoft Teams"),
        Self(id: "com.microsoft.teams", name: "Microsoft Teams"),
        Self(id: "com.tinyspeck.slackmacgap", name: "Slack"),
        Self(id: "com.apple.Safari", name: "Safari"),
        Self(id: "com.google.Chrome", name: "Google Chrome"),
        Self(id: "com.microsoft.edgemac", name: "Microsoft Edge"),
        Self(id: "company.thebrowser.Browser", name: "Arc"),
        Self(id: "com.brave.Browser", name: "Brave"),
        Self(id: "org.mozilla.firefox", name: "Firefox")
    ]
    public static func matching(bundleID: String, executablePath: String = "", running: Set<String> = []) -> Self? {
        if bundleID == "co.calum.callkeep" || bundleID.lowercased().contains("wispr") { return nil }
        if let app = supported.first(where: { bundleID == $0.id || bundleID.hasPrefix($0.id + ".") }) { return app }
        // FaceTime can delegate capture to Apple's AV conferencing service.
        // Do not attribute that shared service to FaceTime unless FaceTime is running.
        if running.contains("com.apple.FaceTime"),
           bundleID.hasPrefix("com.apple.avconferenced") || URL(fileURLWithPath: executablePath).lastPathComponent == "avconferenced" {
            return supported[0]
        }
        return nil
    }
}

/// Debounce microphone activity and remind once until a call has been idle for 15s.
public struct CallActivityFilter: Sendable {
    private struct Seen: Sendable { var first: Double; var last: Double; var reminded = false }
    private var seen: [String: Seen] = [:]
    public init() {}
    public mutating func update(_ apps: [CallingApp], now: Double, recording: Bool) -> CallingApp? {
        seen = seen.filter { now - $0.value.last < 15 }
        for app in apps {
            var state = seen[app.id] ?? Seen(first: now, last: now)
            if now - state.last > 2, !state.reminded { state.first = now }
            state.last = now
            if recording { state.reminded = true }
            seen[app.id] = state
        }
        guard !recording else { return nil }
        for app in apps.sorted(by: { $0.id < $1.id }) {
            guard var state = seen[app.id], !state.reminded, now - state.first >= 5 else { continue }
            state.reminded = true; seen[app.id] = state
            return app
        }
        return nil
    }
    public func isActive(_ id: String, now: Double) -> Bool { seen[id].map { now - $0.last < 15 } ?? false }
}
