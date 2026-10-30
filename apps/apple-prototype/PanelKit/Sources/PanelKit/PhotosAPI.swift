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
public struct WakePhotoListing: Decodable, Sendable {
    public struct Day: Decodable, Sendable {
        public struct Photo: Decodable, Sendable {
            public let path: String
            public let capturedAt: Double
            public let interactionSessionId: String?
        }
        public let day: String
        public let photos: [Photo]
    }
    public let days: [Day]
    public let totalCount: Int
    public let totalBytes: Int
}
public struct PhotoSession: Decodable, Sendable, Identifiable {
    public let id: String
    public let startedAt: Double
    public let endedAt: Double?
    public let durationMs: Double?
    public let eventCount: Int
    public let endReason: String?
    public let deviceName: String
    public let photoPaths: [String]
    public let digest: String?
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
        client = PanelAPIClient(configuration: configuration,
            transport: URLSession(configuration: session, delegate: PhotoSessionDelegate(), delegateQueue: nil))
    }
    public func booth() async throws -> BoothPhotoListing {
        try await client.query("boothPhotos.list", as: BoothPhotoListing.self)
    }
    public func wakes() async throws -> WakePhotoListing {
        try await client.query("wakePhotos.list", as: WakePhotoListing.self)
    }
    public func sessions() async throws -> [PhotoSession] {
        try await client.query("sessions.list", as: [PhotoSession].self)
    }
    public func remove(groupID: String) async throws {
        struct Reply: Decodable, Sendable { let removed: Int }
        _ = try await client.mutation("boothPhotos.remove", input: GroupInput(groupId: groupID), as: Reply.self)
    }
    public func clearFilter(groupID: String) async throws {
        struct Reply: Decodable, Sendable { let cleared: Int }
        _ = try await client.mutation("boothPhotos.clearFilter", input: GroupInput(groupId: groupID), as: Reply.self)
    }
    /// Same synced setting and client-side comparison as the web PIN gate (ADR-0004).
    /// The PIN is never persisted or included in a diagnostic.
    public func unlock(pin: String) async throws -> Bool {
        struct Settings: Decodable, Sendable { let pinCode: String }
        let settings = try await client.query("settings.get", as: Settings.self)
        return pin.count == 6 && pin.allSatisfy(\.isNumber) && pin == settings.pinCode
    }
    public func image(collection: String, path: String) async throws -> Data {
        try await client.photoData(collection: collection, path: path)
    }
    private struct GroupInput: Encodable, Sendable { let groupId: String }
}
