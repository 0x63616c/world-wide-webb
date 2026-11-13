import Foundation

public struct PanelProfile: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let photo: Data
}

public struct ProfilesAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func list() async throws -> [PanelProfile] {
        try await client.get("profiles", as: [PanelProfile].self)
    }

    public func create(name: String, photo: Data, pin: String) async throws -> PanelProfile {
        try await client.post("profiles", input: Input(pin: pin, name: name, photo: photo), as: PanelProfile.self)
    }

    public func update(_ id: String, name: String, photo: Data, pin: String) async throws -> PanelProfile {
        try await client.patch(
            "profiles/\(try PanelAPIClient.component(id))",
            input: Input(pin: pin, name: name, photo: photo), as: PanelProfile.self)
    }

    public func remove(_ id: String, pin: String) async throws {
        struct Reply: Decodable, Sendable { let deleted: Bool }
        _ = try await client.delete(
            "profiles/\(try PanelAPIClient.component(id))", input: ["pin": pin], as: Reply.self)
    }

    private struct Input: Encodable, Sendable {
        let pin: String
        let name: String
        let photo: Data
    }
}
