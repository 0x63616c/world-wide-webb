import Foundation

/// Bounded, device-local diagnostics. Callers supply fixed event names, never user text.
public final class PanelEventLog: @unchecked Sendable {
    public static let shared = PanelEventLog.persistent()
    public static let changedNotification = Notification.Name("PanelEventLogChanged")

    public struct Entry: Codable, Sendable, Identifiable, Equatable {
        public let id: UUID
        public let time: Date
        public let category: String
        public let action: String
        public let outcome: String
        public let status: Int?
        public let durationMs: Int?
    }

    private let lock = NSLock()
    private let writer = DispatchQueue(label: "panel.diagnostics.writer", qos: .utility)
    private let fileURL: URL?
    private var entries: [Entry]
    private var writeScheduled = false
    private var changeScheduled = false
    private var storageFailed = false

    public init(fileURL: URL? = nil) {
        self.fileURL = fileURL
        if let fileURL, FileManager.default.fileExists(atPath: fileURL.path) {
            do {
                entries = Array(try JSONDecoder().decode([Entry].self, from: Data(contentsOf: fileURL)).suffix(500))
            } catch {
                entries = []
                storageFailed = true
            }
        } else {
            entries = []
        }
    }

    public static func persistent() -> PanelEventLog {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("PanelDiagnostics", isDirectory: true)
        return PanelEventLog(fileURL: directory.appendingPathComponent("events.json"))
    }

    public func snapshot() -> [Entry] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }

    public var storageAvailable: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !storageFailed
    }

    public func record(
        category: String, action: String, outcome: String = "ok", status: Int? = nil, durationMs: Int? = nil
    ) {
        let entry = Entry(
            id: UUID(), time: Date(), category: Self.safe(category), action: Self.safe(action),
            outcome: Self.safe(outcome), status: status.map { max(0, min($0, 599)) },
            durationMs: durationMs.map { max(0, min($0, 300_000)) })
        lock.lock()
        entries.append(entry)
        if entries.count > 500 { entries.removeFirst(entries.count - 500) }
        let shouldNotify = !changeScheduled
        changeScheduled = true
        if fileURL != nil && !writeScheduled {
            writeScheduled = true
            writer.asyncAfter(deadline: .now() + 1) { [self] in persist() }
        }
        lock.unlock()
        if shouldNotify {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [self] in
                lock.lock()
                changeScheduled = false
                lock.unlock()
                Foundation.NotificationCenter.default.post(name: Self.changedNotification, object: nil)
            }
        }
    }

    private func persist() {
        lock.lock()
        let copy = entries
        writeScheduled = false
        lock.unlock()
        guard let fileURL, let data = try? JSONEncoder().encode(copy) else { return }
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: fileURL, options: .atomic)
            lock.lock()
            storageFailed = false
            lock.unlock()
        } catch {
            lock.lock()
            storageFailed = true
            lock.unlock()
            Foundation.NotificationCenter.default.post(name: Self.changedNotification, object: nil)
        }
    }

    private static func safe(_ value: String) -> String {
        guard !value.isEmpty, value.count <= 80,
            value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) })
        else { return "unknown" }
        return value
    }
}

public struct PanelEventBatch: Encodable, Sendable {
    public struct Event: Encodable, Sendable {
        public let id: String
        public let time: String
        public let category: String
        public let action: String
        public let outcome: String
        public let status: Int?
        public let durationMs: Int?
    }
    public let deviceId: String
    public let deviceLabel: String
    public let build: String
    public let gitSHA: String
    public let events: [Event]
    public init(
        deviceId: String, deviceLabel: String, build: String = "dev", gitSHA: String = "dev",
        entries: [PanelEventLog.Entry]
    ) {
        self.deviceId = deviceId
        self.deviceLabel = String(deviceLabel.prefix(32))
        self.build = build
        self.gitSHA = gitSHA
        let formatter = ISO8601DateFormatter()
        events = entries.map { entry in
            Event(
                id: entry.id.uuidString, time: formatter.string(from: entry.time),
                category: entry.category, action: entry.action, outcome: entry.outcome,
                status: entry.status, durationMs: entry.durationMs)
        }
    }
}
