import Foundation

/// Client-side capability model, not a claimed backend wire contract. The current
/// API has photos and Sonos controls, but no media catalogue or video stream route.
public struct PanelMediaVideo: Equatable, Sendable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let url: URL

    public init(id: String, title: String, subtitle: String, url: URL) {
        self.id = id; self.title = title; self.subtitle = subtitle; self.url = url
    }
}

public protocol MediaServing: Sendable {
    func videos() async throws -> [PanelMediaVideo]
}

public enum MediaError: Error, Equatable, Sendable {
    case sourceUnavailable, invalidStream, invalidResponse
}

/// Fail closed against today's capabilities. Do not query an invented procedure
/// or turn private wake/booth photos into a video library. Replace this adapter
/// when the separately tracked additive catalogue/stream contract exists.
public struct MediaAPI: MediaServing {
    public init() {}
    public func videos() async throws -> [PanelMediaVideo] {
        try Task.checkCancellation()
        throw MediaError.sourceUnavailable
    }
}

/// Credentials remain in memory and never enter media URLs or descriptions.
public struct MediaStream: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let url: URL
    private let configuration: PanelConfiguration
    public static let chunkSize = 256 * 1024

    public init(url: URL, configuration: PanelConfiguration) throws {
        guard PanelConfiguration.isValidBaseURL(configuration.baseURL),
              configuration.requestTimeout.isFinite, configuration.requestTimeout > 0,
              let source = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false),
              let target = URLComponents(url: url, resolvingAgainstBaseURL: false),
              target.scheme?.lowercased() == source.scheme?.lowercased(),
              target.host?.lowercased() == source.host?.lowercased(),
              Self.port(target) == Self.port(source),
              target.user == nil, target.password == nil, target.fragment == nil,
              target.query == nil else { throw MediaError.invalidStream }
        self.url = url
        self.configuration = configuration
    }

    private static func port(_ url: URLComponents) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }

    public func request(offset: Int64, length: Int) throws -> URLRequest {
        guard offset >= 0, length > 0, length <= Self.chunkSize,
              offset <= Int64.max - Int64(length) else { throw MediaError.invalidStream }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: configuration.requestTimeout)
        request.setValue("bytes=\(offset)-\(offset + Int64(length) - 1)", forHTTPHeaderField: "Range")
        request.setValue("video/mp4", forHTTPHeaderField: "Accept")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let id = configuration.accessClientID, !id.isEmpty,
           let secret = configuration.accessClientSecret, !secret.isEmpty {
            request.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
            request.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        }
        return request
    }

    public var description: String { "MediaStream(<redacted>)" }
    public var debugDescription: String { description }
}
