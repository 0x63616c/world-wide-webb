import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Credentials are memory-only. This type deliberately has no Encodable conformance.
public struct GuestWifiQR: Decodable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let qr: String
    public var description: String { "GuestWifiQR(<redacted>)" }
    public var debugDescription: String { description }
}

public struct WifiAPI: Sendable {
    private let client: PanelAPIClient

    /// Injected clients must use a memory-only transport (for example an ephemeral URLSession).
    public init(client: PanelAPIClient) { self.client = client }

    /// Runtime entry point: avoid shared URLCache/cookie storage for join credentials.
    public init(configuration: PanelConfiguration?) {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.urlCache = nil
        sessionConfiguration.httpCookieStorage = nil
        sessionConfiguration.urlCredentialStorage = nil
        self.client = PanelAPIClient(configuration: configuration,
                                     transport: URLSession(configuration: sessionConfiguration))
    }

    public func guestQr() async throws -> GuestWifiQR {
        try await client.query("wifi.guestQr", as: GuestWifiQR.self)
    }
}
