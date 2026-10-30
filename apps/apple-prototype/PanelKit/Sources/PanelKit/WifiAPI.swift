import Foundation

/// Credentials are memory-only. This type deliberately has no Encodable conformance.
public struct GuestWifiQR: Decodable, Sendable {
    public let qr: String
}

public struct WifiAPI: Sendable {
    private let client: PanelAPIClient

    public init(client: PanelAPIClient) { self.client = client }

    public func guestQr() async throws -> GuestWifiQR {
        try await client.query("wifi.guestQr", as: GuestWifiQR.self)
    }
}
