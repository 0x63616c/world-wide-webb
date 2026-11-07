import Foundation

public struct BoothPhotoFrame: Decodable, Sendable {
    public let id: String
    public let path: String
    public let capturedAt: Double
    public let frameIdx: Int
    public let mimeType: String
    public let filter: String?
}
public struct BoothPhotoGroup: Decodable, Sendable {
    public let groupId: String
    public let mode: String
    public let capturedAt: Double
    public let filter: String?
    public let frames: [BoothPhotoFrame]
}
public struct BoothPhotoListing: Decodable, Sendable {
    public let groups: [BoothPhotoGroup]
    public let totalCount: Int
    public let totalBytes: Int
}
public struct PhotosAPI: Sendable {
    private let client: PanelAPIClient
    /// Injected media transports must reject redirects to keep Access headers on-origin.
    public init(client: PanelAPIClient) { self.client = client }
    public init(configuration: PanelConfiguration?) {
        let session = URLSessionConfiguration.ephemeral
        session.urlCache = nil
        session.httpCookieStorage = nil
        session.urlCredentialStorage = nil
        client = PanelAPIClient(
            configuration: configuration,
            transport: URLSession(configuration: session, delegate: PhotoSessionDelegate(), delegateQueue: nil))
    }
    public func booth() async throws -> BoothPhotoListing {
        try await client.get("booth", as: BoothPhotoListing.self)
    }
    public func savePhoto(jpeg: Data, capturedAt: Date) async throws {
        try await client.uploadBoothPhoto(jpeg: jpeg, capturedAt: capturedAt)
    }
    public func remove(groupID: String) async throws {
        struct Reply: Decodable, Sendable { let removed: Int }
        _ = try await client.delete("booth/" + PanelAPIClient.component(groupID), as: Reply.self)
    }
    public func clearFilter(groupID: String) async throws {
        struct Reply: Decodable, Sendable { let cleared: Int }
        _ = try await client.delete("booth/" + PanelAPIClient.component(groupID) + "/filter", as: Reply.self)
    }
    /// The server verifies the synced PIN; it is never downloaded.
    /// The PIN is never persisted or included in a diagnostic.
    public func unlock(pin: String) async throws -> Bool {
        try await PanelPINAPI(client: client).verify(pin)
    }
    public func image(collection: String, path: String) async throws -> Data {
        try await client.photoData(collection: collection, path: path)
    }
}
