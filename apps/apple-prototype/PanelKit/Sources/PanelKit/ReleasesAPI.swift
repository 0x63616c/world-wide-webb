import Foundation

public struct PanelRelease: Decodable, Sendable, Equatable {
    public let app: String
    public let build: Int
    public let updatedAt: String
}

/// Uses the same Access-authenticated tRPC transport as other panel reads.
public struct ReleasesAPI: Sendable {
    private let client: PanelAPIClient

    public init(client: PanelAPIClient) { self.client = client }

    public func latest(app: String = "panel") async throws -> PanelRelease {
        let release = try await client.query("releases.latest", input: ["app": app], as: PanelRelease.self)
        guard release.app == app, release.build > 0, release.build <= 2_147_483_647,
              ISO8601DateFormatter().date(from: release.updatedAt) != nil
                || Self.fractionalDate(release.updatedAt) != nil else {
            throw PanelAPIError.decoding("Invalid release response.")
        }
        return release
    }

    private static func fractionalDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}
