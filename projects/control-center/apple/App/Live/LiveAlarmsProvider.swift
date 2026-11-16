import Foundation
import Observation
import PanelKit

@MainActor @Observable final class LiveAlarmsProvider {
    private(set) var snapshot: AlarmsSnapshot?
    private(set) var availability: LiveAvailability = .loading
    private(set) var pending = false
    private(set) var errorMessage: String?
    @ObservationIgnored private let api: AlarmsAPI
    @ObservationIgnored private var identities: [String: Int] = [:]
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var polling = false
    @ObservationIgnored private var mutation: Task<Void, Never>?
    @ObservationIgnored private var projectedAlarms: [Alarm]?
    @ObservationIgnored private var formatters: [String: DateFormatter] = [:]

    init(api: AlarmsAPI) { self.api = api }

    // Presentation IDs are local handles, not API IDs. Preserve the mapping across
    // reorders, deletes and refreshes; never send the local integer to the API.
    private func identity(_ id: String) -> Int {
        if let value = identities[id] { return value }
        let value = identities.count + 1
        identities[id] = value
        return value
    }

    /// Projection formats dates per alarm; reuse it until the snapshot changes.
    var alarms: [Alarm] {
        guard let snapshot else { return [] }
        if let projectedAlarms { return projectedAlarms }
        let value = snapshot.alarms.map(project)
        projectedAlarms = value
        return value
    }
    var newAlarm: Alarm {
        var alarm = Alarm()
        alarm.timeZone = PanelTimeZone.current.identifier
        alarm.snoozeMinutes = ""  // Blank uses the backend default, just like the web.
        return alarm
    }

    private func project(_ value: AlarmDefinition) -> Alarm {
        var alarm = Alarm(
            id: identity(value.id), label: value.label, time: value.time,
            timeZone: value.timeZone, repeatDays: Set(value.repeatDays),
            snoozeMinutes: value.snoozeMinutes.map(String.init) ?? "",
            lightTarget: value.lightTarget ?? "", enabled: value.enabled)
        if let at = value.at, let date = AlarmDate.parse(at) {
            alarm.date = formatter("yyyy-MM-dd", zone: value.timeZone).string(from: date)
            alarm.time = formatter("HH:mm", zone: value.timeZone).string(from: date)
        }
        return alarm
    }

    func ringing(at date: Date) -> [ActiveAlarm] { snapshot?.active.filter { $0.isRinging(at: date) } ?? [] }

    func upcoming(at date: Date) -> UpcomingAlarm? {
        guard let snapshot else { return nil }
        if let ring = ringing(at: date).first, let due = AlarmDate.parse(ring.ringAt) {
            return UpcomingAlarm(alarm: project(ring), due: due, ringing: true, version: ring.version, snoozed: false)
        }
        guard let next = snapshot.next, let due = AlarmDate.parse(next.at), due > date else { return nil }
        if let ring = snapshot.active.first(where: { $0.id == next.id && $0.status == .snoozed }) {
            return UpcomingAlarm(alarm: project(ring), due: due, ringing: false, version: ring.version, snoozed: true)
        }
        guard let definition = snapshot.alarms.first(where: { $0.id == next.id }) else { return nil }
        return UpcomingAlarm(alarm: project(definition), due: due, ringing: false, version: nil, snoozed: false)
    }

    private func project(_ ring: ActiveAlarm) -> Alarm {
        var alarm = snapshot?.alarms.first(where: { $0.id == ring.alarmId }).map(project) ?? newAlarm
        // Occurrences have their own stable handle; two rings of one definition
        // must never turn a stale button into an action on a different occurrence.
        alarm.id = identity(ring.id)
        alarm.label = ring.label
        alarm.snoozeMinutes = String(ring.snoozeMinutes)
        if let due = AlarmDate.parse(ring.ringAt) {
            alarm.time = formatter("HH:mm", zone: alarm.timeZone).string(from: due)
        }
        return alarm
    }

    /// Clock faces project the upcoming alarm every second; reuse fixed-format formatters.
    private func formatter(_ format: String, zone: String) -> DateFormatter {
        let key = format + "|" + zone
        if let cached = formatters[key] { return cached }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let timeZone = TimeZone(identifier: zone)
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        // An unknown zone falls back to the (changeable) default zone; don't pin it.
        if timeZone != nil { formatters[key] = formatter }
        return formatter
    }

    func refresh() async {
        guard !pending, !polling else { return }
        polling = true
        let expected = revision
        defer { polling = false }
        do {
            let value = try await api.list()
            try Task.checkCancellation()
            guard expected == revision else { return }
            accept(value)
        } catch {
            guard expected == revision, !(error is CancellationError) else { return }
            setAvailability(.unavailable("Alarms are unavailable. Reconnecting…"))
        }
    }

    func save(_ alarm: Alarm) async throws {
        if let error = alarm.validationError { throw Failure(message: error) }
        guard alarm.lightTarget.count <= 1000 else {
            throw Failure(message: "Use at most 1000 characters for light targets.")
        }
        var input = AlarmInput(
            label: alarm.label.trimmingCharacters(in: .whitespacesAndNewlines),
            time: alarm.time, timeZone: alarm.timeZone, repeatDays: alarm.repeatDays.sorted(),
            snoozeMinutes: Int(alarm.snoozeMinutes), lightTarget: alarm.lightTarget.isEmpty ? nil : alarm.lightTarget)
        if !alarm.date.isEmpty, let exact = alarm.exactDate {
            input.at = ISO8601DateFormatter().string(from: exact)
            input.repeatDays = []
            // Preserve sub-minute exact dates from Shortcuts when the displayed
            // date/time/zone were not edited.
            if let original = snapshot?.alarms.first(where: { identity($0.id) == alarm.id }),
                project(original).date == alarm.date, project(original).time == alarm.time,
                original.timeZone == alarm.timeZone
            {
                input.at = original.at
            }
        }
        let payload = input
        let id = try alarm.id == 0 ? nil : definitionID(alarm.id)
        try await write {
            if let id { try await self.api.update(id: id, alarm: payload) } else { try await self.api.create(payload) }
        }
    }

    func setEnabled(_ id: Int, enabled: Bool) async throws {
        let id = try definitionID(id)
        try await write { try await self.api.setEnabled(id: id, enabled: enabled) }
    }
    func delete(_ id: Int) async throws {
        let id = try definitionID(id)
        try await write { try await self.api.delete(id: id) }
    }
    func act(_ id: Int, version: Int, snooze: Bool, now: Date = Date()) async throws {
        guard let ring = snapshot?.active.first(where: { identity($0.id) == id }), ring.version == version,
            snooze ? ring.isRinging(at: now) : (AlarmDate.parse(ring.expiresAt).map { $0 > now } ?? false)
        else { throw Failure(message: "This alarm has changed. Refresh and try again.") }
        try await write {
            if snooze {
                try await self.api.snooze(id: ring.id, version: version)
            } else {
                try await self.api.stop(id: ring.id, version: version)
            }
        }
    }

    func send(_ command: HomeCommand) {
        guard mutation == nil else {
            PanelCommandLog.shared.record(control: "alarms.command", error: "dropped: action unavailable")
            errorMessage = "Wait for the current alarm change."
            return
        }
        mutation = Task { [weak self] in
            guard let self else { return }
            defer { self.mutation = nil }
            do {
                switch command {
                case .saveAlarm(let alarm): try await save(alarm)
                case .enableAlarm(let id, let enabled): try await setEnabled(id, enabled: enabled)
                case .deleteAlarm(let id): try await delete(id)
                case .snoozeAlarm(let id, let version): try await act(id, version: version, snooze: true)
                case .stopAlarm(let id, let version): try await act(id, version: version, snooze: false)
                default: break
                }
            } catch is CancellationError {} catch {
                PanelCommandLog.shared.record(control: "alarms.command", error: "request failed")
                errorMessage = (error as? Failure)?.message ?? "Could not change the alarm. Try again."
            }
        }
    }

    private func definitionID(_ local: Int) throws -> String {
        guard let id = snapshot?.alarms.first(where: { identity($0.id) == local })?.id else {
            throw Failure(message: "This alarm no longer exists. Refresh and try again.")
        }
        return id
    }

    private func write(_ operation: () async throws -> Void) async throws {
        guard !pending else { throw Failure(message: "Wait for the current alarm change.") }
        pending = true
        revision += 1
        errorMessage = nil
        defer { pending = false }
        do {
            try await operation()
        } catch {
            if error is CancellationError { throw error }
            // A 409 means another panel acted first. Refetch, never retry a write.
            if let value = try? await api.list() { accept(value) }
            let message = "Could not change the alarm. Its state may have changed; try again."
            errorMessage = message
            throw Failure(message: message)
        }
        // Acknowledgement is authoritative even if the following read fails.
        // Do not tell an editor to retry an already-created non-idempotent alarm.
        do { accept(try await api.list()) } catch {
            setAvailability(.unavailable("Alarm saved. Waiting to reconnect…"))
        }
    }

    /// Polled every second: assign only on change so Observation does not invalidate
    /// every clock/launcher view that reads alarms on each identical sample.
    private func accept(_ value: AlarmsSnapshot) {
        if snapshot != value {
            snapshot = value
            projectedAlarms = nil
        }
        for alarm in value.alarms { _ = identity(alarm.id) }
        for ring in value.active { _ = identity(ring.id) }
        setAvailability(.live)
    }

    private func setAvailability(_ value: LiveAvailability) {
        if availability != value { availability = value }
    }

    func stop() {
        revision += 1
        mutation?.cancel()
        mutation = nil
    }
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
}
