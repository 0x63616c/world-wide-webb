import Foundation

/// The Mini's summary of its NAS uploads and deployments, written by Homelab.
public struct HostStatus: Decodable, Sendable, Equatable {
    public struct Check: Decodable, Sendable, Equatable {
        /// `ok`, `failing` (NAS) or `blocked` (deploy). Anything else is treated as unknown.
        public let state: String
        public let since: Date?
        public let reason: String?

        public init(state: String, since: Date? = nil, reason: String? = nil) {
            self.state = state
            self.since = since
            self.reason = reason
        }

        private enum CodingKeys: String, CodingKey { case state, since, reason }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            state = try container.decode(String.self, forKey: .state)
            reason = try container.decodeIfPresent(String.self, forKey: .reason)
            since = try container.decodeIfPresent(String.self, forKey: .since).flatMap(HostStatus.date)
        }
    }

    static func date(_ text: String) -> Date? {
        (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text))
            ?? (try? Date.ISO8601FormatStyle().parse(text))
    }

    public let nas: Check
    public let deploy: Check
    /// True when Homelab has not refreshed the file recently; the checks are then unknown.
    public let stale: Bool
    public let updatedAt: Date?

    public init(nas: Check, deploy: Check, stale: Bool = false, updatedAt: Date? = nil) {
        self.nas = nas
        self.deploy = deploy
        self.stale = stale
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey { case nas, deploy, stale, updatedAt }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        nas = try container.decode(Check.self, forKey: .nas)
        deploy = try container.decode(Check.self, forKey: .deploy)
        stale = try container.decode(Bool.self, forKey: .stale)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt).flatMap(Self.date)
    }
}

/// One persistent notice the panel shows until the host recovers.
public struct HostNotice: Sendable, Equatable {
    public let key: String
    public let title: String
    public let body: String

    public init(key: String, title: String, body: String) {
        self.key = key
        self.title = title
        self.body = body
    }
}

extension HostStatus {
    /// Brief NAS blips (a reboot, one slow upload) stay quiet.
    public static let nasGrace: TimeInterval = 15 * 60

    /// A NAS failure also blocks deploys, so it is reported once rather than twice.
    public func notices(now: Date) -> [HostNotice] {
        guard !stale else { return [] }
        if nas.state == "failing", let since = nas.since, now.timeIntervalSince(since) >= Self.nasGrace {
            return [
                HostNotice(
                    key: "host-nas", title: "NAS unavailable",
                    body: Self.sentence("Backups and Mini updates are paused", nas.reason))
            ]
        }
        if deploy.state == "blocked" {
            return [
                HostNotice(
                    key: "host-deploy", title: "Mini updates paused",
                    body: Self.sentence("New versions aren’t being installed", deploy.reason))
            ]
        }
        return []
    }

    private static func sentence(_ lead: String, _ reason: String?) -> String {
        guard let reason = reason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty else {
            return lead + "."
        }
        return "\(lead). \(reason.hasSuffix(".") ? reason : reason + ".")"
    }
}

/// A redacted tail of one Mini log (a container, deploys or backups).
public struct HostLog: Decodable, Sendable, Equatable {
    public let source: String
    public let lines: [String]

    public init(source: String, lines: [String]) {
        self.source = source
        self.lines = lines
    }

    /// Lines worth looking at first when something is wrong.
    public var errors: [String] {
        lines.filter { line in Self.errorWords.contains { line.range(of: $0, options: .caseInsensitive) != nil } }
    }

    static let errorWords = ["error", "fail", "panic", "fatal", "exception", "denied", "refused", "timed out"]
}

public struct HostStatusAPI: Sendable {
    private struct Sources: Decodable {
        struct Source: Decodable { let name: String }
        let sources: [Source]
    }

    private let client: PanelAPIClient

    public init(client: PanelAPIClient) { self.client = client }

    public func status() async throws -> HostStatus {
        try await client.get("host/status", as: HostStatus.self)
    }

    public func logSources() async throws -> [String] {
        try await client.get("host/logs", as: Sources.self).sources.map(\.name)
    }

    public func log(_ source: String) async throws -> HostLog {
        guard source.allSatisfy({ $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "-") }) else {
            throw PanelAPIError.http(status: 404)
        }
        return try await client.get("host/logs/\(source)", as: HostLog.self)
    }
}
