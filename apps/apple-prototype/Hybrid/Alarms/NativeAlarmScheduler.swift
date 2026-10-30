import AlarmKit
import AppIntents
import Foundation
import PanelKit
import SwiftUI

/// Only the server's next instant (or oldest active ring) is scheduled. There is
/// no parallel AVAudioPlayer/web sound loop and no client recurrence calculation.
struct AlarmDelivery: Codable, Equatable, Sendable {
    let sourceID: String
    let at: String
    let label: String
    let version: Int?

    static func next(in snapshot: AlarmsSnapshot, now: Date) -> Self? {
        if let ring = snapshot.active.first(where: { $0.isRinging(at: now) }) {
            return Self(sourceID: ring.id, at: ring.ringAt, label: ring.label, version: ring.version)
        }
        guard let next = snapshot.next, let date = AlarmDate.parse(next.at), date > now else { return nil }
        return Self(sourceID: next.id, at: next.at, label: next.label, version: nil)
    }

    func matches(_ ring: ActiveAlarm) -> Bool {
        (sourceID == ring.id || sourceID == ring.alarmId) && AlarmDate.parse(at) == AlarmDate.parse(ring.ringAt)
            && (version == nil || version == ring.version)
    }
}

@MainActor protocol NativeAlarmScheduling {
    func authorize() async throws -> Bool
    func sync(_ snapshot: AlarmsSnapshot) async throws
    func cancel() throws
}

private struct PanelAlarmMetadata: AlarmMetadata {}

@MainActor final class NativeAlarmScheduler: NativeAlarmScheduling {
    static let shared = NativeAlarmScheduler()
    private struct Record: Codable {
        let id: UUID
        let delivery: AlarmDelivery
    }
    private let defaults: UserDefaults
    private let key = "panel.nativeAlarm.schedule.v1"
    private var record: Record? {
        get { defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Record.self, from: $0) } }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: key) }
    }
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func authorize() async throws -> Bool {
        let manager = AlarmManager.shared
        if manager.authorizationState == .notDetermined { return try await manager.requestAuthorization() == .authorized }
        return manager.authorizationState == .authorized
    }

    func sync(_ snapshot: AlarmsSnapshot) async throws {
        let now = Date()
        // Do not silence the system alert during the worker's claim delay.
        if let record, let date = AlarmDate.parse(record.delivery.at), date <= now,
           now.timeIntervalSince(date) < 1800,
           snapshot.next?.id == record.delivery.sourceID, snapshot.next?.at == record.delivery.at,
           try AlarmManager.shared.alarms.contains(where: { $0.id == record.id }) { return }
        let desired = AlarmDelivery.next(in: snapshot, now: now)
        if let record, let desired {
            let existing = try AlarmManager.shared.alarms.first { $0.id == record.id }
            // At fire time the server replaces alm_* next with alr_* active. Keep
            // the already-alerting system alarm instead of canceling/restarting it.
            let sameOccurrence = snapshot.active.contains { desired.matches($0) && record.delivery.matches($0) }
            if existing != nil && (record.delivery == desired || sameOccurrence) { return }
        }
        try cancel()
        guard let desired, let date = AlarmDate.parse(desired.at) else { return }
        guard AlarmManager.shared.authorizationState == .authorized else { throw NativeAlarmFailure.unavailable }
        let alert: AlarmPresentation.Alert
        let secondary = AlarmButton(text: "Snooze", textColor: .orange, systemImageName: "zzz")
        if #available(iOS 26.1, *) {
            alert = .init(title: LocalizedStringResource(stringLiteral: desired.label), secondaryButton: secondary, secondaryButtonBehavior: .custom)
        } else {
            alert = .init(title: LocalizedStringResource(stringLiteral: desired.label),
                          stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill"),
                          secondaryButton: secondary, secondaryButtonBehavior: .custom)
        }
        let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert), metadata: PanelAlarmMetadata(), tintColor: .orange)
        let id = UUID() // AlarmKit requires a local UUID; backend IDs remain unchanged.
        let configuration = AlarmManager.AlarmConfiguration.alarm(
            schedule: .fixed(max(date, now.addingTimeInterval(1))), attributes: attributes,
            stopIntent: StopNativeAlarmIntent(delivery: desired), secondaryIntent: SnoozeNativeAlarmIntent(delivery: desired))
        // Store before the await so process death cannot orphan a system alarm.
        record = Record(id: id, delivery: desired)
        _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
        // A document navigation can cancel while schedule() is suspended.
        // Cancel the returned ID explicitly even if the persisted record cleared.
        if record?.id != id { try AlarmManager.shared.cancel(id: id) }
    }

    func cancel() throws {
        if let record, try AlarmManager.shared.alarms.contains(where: { $0.id == record.id }) {
            try AlarmManager.shared.cancel(id: record.id)
        }
        record = nil
    }
}

enum NativeAlarmFailure: LocalizedError {
    case unavailable
    var errorDescription: String? { "Native alarms are unavailable. Open Control Center to reconnect." }
}

struct StopNativeAlarmIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop panel alarm"
    @Parameter(title: "Occurrence") var deliveryJSON: String
    init() {}
    init(delivery: AlarmDelivery) { deliveryJSON = String(decoding: (try? JSONEncoder().encode(delivery)) ?? Data(), as: UTF8.self) }
    func perform() async throws -> some IntentResult {
        let delivery = try JSONDecoder().decode(AlarmDelivery.self, from: Data(deliveryJSON.utf8))
        try await PanelAlarmCoordinator.shared.act(delivery: delivery, snooze: false)
        return .result()
    }
}

struct SnoozeNativeAlarmIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Snooze panel alarm"
    @Parameter(title: "Occurrence") var deliveryJSON: String
    init() {}
    init(delivery: AlarmDelivery) { deliveryJSON = String(decoding: (try? JSONEncoder().encode(delivery)) ?? Data(), as: UTF8.self) }
    func perform() async throws -> some IntentResult {
        let delivery = try JSONDecoder().decode(AlarmDelivery.self, from: Data(deliveryJSON.utf8))
        try await PanelAlarmCoordinator.shared.act(delivery: delivery, snooze: true)
        return .result()
    }
}
