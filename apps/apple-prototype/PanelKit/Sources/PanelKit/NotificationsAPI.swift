import Foundation

public enum NotificationPriority: String, Codable, Sendable, CaseIterable {
    case low, normal, high, critical

    public var rank: Int {
        switch self { case .low: 0; case .normal: 1; case .high: 2; case .critical: 3 }
    }

    public var bannerDuration: TimeInterval? {
        switch self { case .low, .normal: 5; case .high: 10; case .critical: nil }
    }
}

/// Exact WWW-58 row; revision stays a string through decoding (Postgres bigint).
public struct PanelNotification: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let sourceModule: String
    public let title: String
    public let body: String
    public let deepLink: String
    public let priority: NotificationPriority
    public let dedupeKey: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let readAt: Date?
    public let dismissedAt: Date?
    public let revision: String

    enum CodingKeys: String, CodingKey {
        case id, title, body, priority, revision
        case sourceModule = "source_module", deepLink = "deep_link", dedupeKey = "dedupe_key"
        case createdAt = "created_at", updatedAt = "updated_at", readAt = "read_at", dismissedAt = "dismissed_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sourceModule = try c.decode(String.self, forKey: .sourceModule)
        title = try c.decode(String.self, forKey: .title)
        body = try c.decode(String.self, forKey: .body)
        deepLink = try c.decode(String.self, forKey: .deepLink)
        priority = try c.decode(NotificationPriority.self, forKey: .priority)
        dedupeKey = try c.decodeIfPresent(String.self, forKey: .dedupeKey)
        revision = try c.decode(String.self, forKey: .revision)
        func date(_ key: CodingKeys) throws -> Date {
            let value = try c.decode(String.self, forKey: key)
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = format.date(from: value) { return date }
            format.formatOptions = [.withInternetDateTime]
            guard let date = format.date(from: value) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "Invalid notification timestamp")
            }
            return date
        }
        createdAt = try date(.createdAt)
        updatedAt = try date(.updatedAt)
        readAt = try c.decodeNil(forKey: .readAt) ? nil : date(.readAt)
        dismissedAt = try c.decodeNil(forKey: .dismissedAt) ? nil : date(.dismissedAt)
        guard NotificationsAPI.validCursor(revision) else {
            throw DecodingError.dataCorruptedError(forKey: .revision, in: c, debugDescription: "Invalid notification revision")
        }
    }
}

public struct NotificationPage: Decodable, Sendable {
    public let items: [PanelNotification]
    public let cursor: String
    public let hasMore: Bool
    enum CodingKeys: String, CodingKey { case items, cursor; case hasMore = "has_more" }

    public init(items: [PanelNotification], cursor: String, hasMore: Bool) {
        self.items = items; self.cursor = cursor; self.hasMore = hasMore
    }
}

public protocol NotificationsServing: Sendable {
    func list(since: String?) async throws -> NotificationPage
    func markRead(id: String) async throws -> PanelNotification
    func dismiss(id: String) async throws -> PanelNotification
    func dismissAll() async throws -> Int
}

/// WWW-58's equivalent tRPC procedures reuse the LightsAPI transport and Access policy.
/// Poll unfiltered pages every five seconds; a filtered feed loses read/dismiss changes.
public struct NotificationsAPI: NotificationsServing {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func list(since: String? = nil) async throws -> NotificationPage {
        if let since, !Self.validCursor(since) { throw PanelAPIError.decoding("Invalid notification cursor.") }
        struct Input: Encodable, Sendable { let since: String?; let limit = 200 }
        let page = try await client.query("notifications.list", input: Input(since: since), as: NotificationPage.self)
        guard Self.validCursor(page.cursor), let cursor = Int64(page.cursor),
              cursor >= Int64(since ?? "0")!, page.items.count <= 200,
              !page.hasMore || !page.items.isEmpty else {
            throw PanelAPIError.decoding("Invalid notification page.")
        }
        var previous = Int64(since ?? "0")!
        for item in page.items {
            guard let revision = Int64(item.revision), revision > previous, revision <= cursor else {
                throw PanelAPIError.decoding("Unordered notification page.")
            }
            previous = revision
        }
        guard cursor == previous else { throw PanelAPIError.decoding("Invalid notification cursor.") }
        return page
    }

    public func markRead(id: String) async throws -> PanelNotification {
        try await client.mutation("notifications.read", input: ["id": id], as: PanelNotification.self)
    }

    public func dismiss(id: String) async throws -> PanelNotification {
        try await client.mutation("notifications.dismiss", input: ["id": id], as: PanelNotification.self)
    }

    public func dismissAll() async throws -> Int {
        struct Output: Decodable, Sendable { let dismissed: Int }
        return try await client.mutation("notifications.dismissAll", input: [String: String](), as: Output.self).dismissed
    }

    public static func validCursor(_ value: String) -> Bool {
        guard !value.isEmpty, value == "0" || value.first != "0",
              value.allSatisfy({ $0.isASCII && $0.isNumber }), let number = Int64(value) else { return false }
        return number >= 0
    }
}
