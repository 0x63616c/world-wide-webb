import Foundation

public struct VacuumSnapshot: Decodable, Sendable {
    public struct Room: Decodable, Identifiable, Sendable {
        public let id: String
        public let name: String
    }
    public let status: String
    public let battery: Double?
    public let rooms: [Room]
}

public struct VacuumAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func list() async throws -> VacuumSnapshot {
        try await client.get("vacuum", as: VacuumSnapshot.self)
    }

    public enum Action: String, Sendable { case start, pause, stop, dock, room }
    public func command(_ action: Action, room: String? = nil) async throws {
        struct Input: Encodable, Sendable {
            let action: String
            let room: String?
        }
        struct Acknowledgement: Decodable, Sendable { let ok: Bool }
        let _: Acknowledgement = try await client.post(
            "vacuum", input: Input(action: action.rawValue, room: room), as: Acknowledgement.self)
    }
}
