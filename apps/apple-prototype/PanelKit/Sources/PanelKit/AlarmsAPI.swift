import Foundation

/// Wire contract: features/events/contract.ts and service.snapshot(). Dates stay
/// ISO strings on the wire; the server alone computes recurrence and DST rules.
public struct AlarmInput: Codable, Equatable, Sendable {
    public var label: String
    public var time: String
    public var timeZone: String
    public var repeatDays: [Int]
    public var at: String?
    public var snoozeMinutes: Int?
    public var lightTarget: String?

    public init(label: String, time: String, timeZone: String, repeatDays: [Int] = [],
                at: String? = nil, snoozeMinutes: Int? = nil, lightTarget: String? = nil) {
        self.label = label; self.time = time; self.timeZone = timeZone
        self.repeatDays = repeatDays; self.at = at
        self.snoozeMinutes = snoozeMinutes; self.lightTarget = lightTarget
    }
}

public struct AlarmDefinition: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let time: String
    public let timeZone: String
    public let repeatDays: [Int]
    public let at: String?
    public let snoozeMinutes: Int?
    public let lightTarget: String?
    public let enabled: Bool
    public let nextFireAt: String?
}

public struct ActiveAlarm: Codable, Equatable, Sendable, Identifiable {
    public enum Status: String, Codable, Sendable { case ringing, snoozed, stopped, missed }
    public let id: String
    public let alarmId: String
    public let label: String
    public let status: Status
    public let version: Int
    public let ringAt: String
    public let expiresAt: String
    public let snoozeMinutes: Int
    public let lightsPending: Bool

    public func isRinging(at now: Date) -> Bool {
        status == .ringing && (AlarmDate.parse(expiresAt).map { $0 > now } ?? false)
    }
}

public struct AlarmNext: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let at: String
    public let timeZone: String
}

public struct AlarmsSnapshot: Codable, Equatable, Sendable {
    public struct Defaults: Codable, Equatable, Sendable {
        public let snoozeMinutes: Int
        public let lightTarget: String
    }
    public let alarms: [AlarmDefinition]
    public let active: [ActiveAlarm]
    public let next: AlarmNext?
    public let defaults: Defaults
    public let serverNow: String
}

public enum AlarmDate {
    public static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

public struct AlarmsAPI: Sendable {
    private struct Acknowledgement: Decodable, Sendable { let id: String }
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func list() async throws -> AlarmsSnapshot {
        let value = try await client.query("alarms.list", as: AlarmsSnapshot.self)
        guard AlarmDate.parse(value.serverNow) != nil,
              value.next.map({ AlarmDate.parse($0.at) != nil }) ?? true,
              value.alarms.allSatisfy({ $0.nextFireAt.map { AlarmDate.parse($0) != nil } ?? true }),
              value.active.allSatisfy({ AlarmDate.parse($0.ringAt) != nil && AlarmDate.parse($0.expiresAt) != nil && $0.version >= 0 })
        else { throw PanelAPIError.decoding("Invalid alarm snapshot.") }
        return value
    }

    public func create(_ alarm: AlarmInput) async throws {
        _ = try await client.mutation("alarms.create", input: alarm, as: Acknowledgement.self)
    }
    public func update(id: String, alarm: AlarmInput) async throws {
        struct Input: Encodable, Sendable { let id: String; let alarm: AlarmInput }
        _ = try await client.mutation("alarms.update", input: Input(id: id, alarm: alarm), as: Acknowledgement.self)
    }
    public func setEnabled(id: String, enabled: Bool) async throws {
        struct Input: Encodable, Sendable { let id: String; let enabled: Bool }
        _ = try await client.mutation("alarms.setEnabled", input: Input(id: id, enabled: enabled), as: Acknowledgement.self)
    }
    public func delete(id: String) async throws {
        _ = try await client.mutation("alarms.delete", input: ["id": id], as: Acknowledgement.self)
    }
    public func snooze(id: String, version: Int) async throws { try await act("alarms.snooze", id: id, version: version) }
    public func stop(id: String, version: Int) async throws { try await act("alarms.stop", id: id, version: version) }

    private func act(_ procedure: String, id: String, version: Int) async throws {
        struct Input: Encodable, Sendable { let id: String; let version: Int }
        _ = try await client.mutation(procedure, input: Input(id: id, version: version), as: Acknowledgement.self)
    }
}
