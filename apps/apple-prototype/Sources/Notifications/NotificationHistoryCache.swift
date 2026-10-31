import Foundation

struct NotificationHistorySnapshot: Codable {
    var version = 1
    let items: [NotificationItem]
    let revisions: [String: Int64]
    let cursor: String?
    let lastSync: Date?
}

@MainActor protocol NotificationHistoryCaching {
    func load() throws -> NotificationHistorySnapshot?
    func save(_ snapshot: NotificationHistorySnapshot) throws
}

/// Application Support survives relaunch and cache eviction; never backed up to iCloud.
@MainActor struct FileNotificationHistoryCache: NotificationHistoryCaching {
    let url: URL

    func load() throws -> NotificationHistorySnapshot? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(NotificationHistorySnapshot.self, from: Data(contentsOf: url))
    }

    func save(_ snapshot: NotificationHistorySnapshot) throws {
        var directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        let data = try JSONEncoder().encode(snapshot)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
}
