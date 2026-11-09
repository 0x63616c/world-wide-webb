import SwiftUI
@preconcurrency import UserNotifications

@MainActor @Observable final class Store {
    var journal = Journal()
    var error: String?
    var reminderStatus = "Off"
    var healthKitStatus = "Not connected"
    let demo: Bool
    private var canWrite = true
    private var healthKitSyncInFlight = false
    private var healthKitRefreshRequested = false
    private let file: JournalFile
    var analyticsWeights: [WeightEntry] { journal.weights.resolvedForAnalytics }
    var firstDoseDate: Date? { journal.firstTakenDoseDate }
    var treatmentWeights: [WeightEntry] {
        guard let firstDoseDate else { return analyticsWeights }
        return analyticsWeights.filter { $0.date >= firstDoseDate }
    }
    init() {
        demo = ProcessInfo.processInfo.arguments.contains("--demo")
        let root = URL.applicationSupportDirectory.appendingPathComponent("Still", isDirectory: true)
        file = JournalFile(url: root.appendingPathComponent(ProcessInfo.processInfo.arguments.contains("--uitest") ? "test.json" : "journal.json"))
        if ProcessInfo.processInfo.arguments.contains("--uitest"), ProcessInfo.processInfo.arguments.contains("--reset-test-journal") {
            try? FileManager.default.removeItem(at: file.url)
        }
        if demo { journal = ProcessInfo.processInfo.arguments.contains("--screenshots") ? Self.screenshotJournal() : Self.demoJournal() }
        else {
            do { journal = try file.load() } catch { canWrite = false; self.error = "Your journal could not be opened. Please keep the app installed to preserve your data. \(error.localizedDescription)" }
        }
    }
    func exportJournal() throws -> Data {
        guard canWrite else { throw TrackingError.invalidFile }
        return try JournalFile.export(journal)
    }
    func commit(_ changed: Journal) -> Bool {
        guard canWrite else { error = "Your existing journal could not be opened. Saving is paused to preserve it."; return false }
        do {
            var normalized = changed
            normalized.applyWeightHistoryStart()
            if !demo { try file.save(normalized) }
            journal = normalized
            return true
        } catch { self.error = "Could not save. \(error.localizedDescription)"; return false }
    }
    func save(weight: WeightEntry) -> Bool {
        guard EntryValidation.weight(weight.kilograms) else { error = TrackingError.invalidAmount.localizedDescription; return false }
        if journal.weightsStartAtFirstDose, let firstDoseDate, weight.date < firstDoseDate {
            error = "Choose a date on or after your first dose."
            return false
        }
        var next = journal
        next.weights.removeAll { $0.id == weight.id }; next.weights.append(weight)
        return commit(next)
    }
    @discardableResult func setWeightsStartAtFirstDose(_ enabled: Bool) -> Bool {
        var next = journal
        next.weightsStartAtFirstDose = enabled
        return commit(next)
    }
    func connectHealthKit() async {
        do {
            let changes = try await HealthKitWeightStore.requestAndFetch()
            var next = journal
            next.healthKitWeightsEnabled = true
            next.lastHealthKitSync = Date()
            next.applyHealthKitWeightChanges(
                added: changes.added,
                deletedIDs: changes.deletedIDs,
                replacesAllHealthKitWeights: changes.replacesAllHealthKitWeights
            )
            if commit(next) {
                HealthKitWeightStore.saveAnchor(changes.anchorData)
                let retained = journal.weights.filter { $0.healthKitID != nil }.count
                healthKitStatus = retained == 0 ? "No weights available" : "Synced \(retained) weights"
            }
        } catch {
            healthKitStatus = "Could not sync"
            self.error = error.localizedDescription
        }
    }
    func refreshHealthKit() async {
        guard journal.healthKitWeightsEnabled else { return }
        if healthKitSyncInFlight {
            healthKitRefreshRequested = true
            return
        }
        healthKitSyncInFlight = true
        repeat {
            healthKitRefreshRequested = false
            do {
                let changes = try await HealthKitWeightStore.fetchChanges()
                var next = journal
                next.lastHealthKitSync = Date()
                next.applyHealthKitWeightChanges(
                    added: changes.added,
                    deletedIDs: changes.deletedIDs,
                    replacesAllHealthKitWeights: changes.replacesAllHealthKitWeights
                )
                if commit(next) {
                    HealthKitWeightStore.saveAnchor(changes.anchorData)
                    let retained = journal.weights.filter { $0.healthKitID != nil }.count
                    healthKitStatus = retained == 0 ? "No weights available" : "Synced \(retained) weights"
                }
            } catch {
                healthKitStatus = "Could not sync"
            }
        } while healthKitRefreshRequested
        healthKitSyncInFlight = false
    }

    func save(dose: DoseEntry, inputUnit: String? = nil) -> Bool {
        do { try dose.validate(now: Date()) } catch { self.error = error.localizedDescription; return false }
        var next = journal
        if let inputUnit { next.doseInputUnit = inputUnit }
        next.doses.removeAll { $0.id == dose.id }; next.doses.append(dose)
        return commit(next)
    }
    /// Removes the schedule and any reminders it had queued.
    @discardableResult func clearSchedule() -> Bool {
        var next = journal
        next.schedule.clear()
        guard commit(next) else { return false }
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        reminderStatus = "No schedule set"
        return true
    }
    @discardableResult func delete(weight: WeightEntry) -> Bool { var next = journal; next.weights.removeAll { $0.id == weight.id }; return commit(next) }
    @discardableResult func delete(dose: DoseEntry) -> Bool { var next = journal; next.doses.removeAll { $0.id == dose.id }; return commit(next) }
    static let reminderTitle = "A quick reminder"
    static let reminderBody = "It’s time for your scheduled dose. Open Tendr when you’re ready."
    func syncReminders() async {
        guard !demo else { reminderStatus = "Demo • no notifications"; return }
        let center = UNUserNotificationCenter.current()
        guard journal.schedule.enabled, journal.schedule.cadence != .none else {
            center.removeAllPendingNotificationRequests()
            reminderStatus = journal.schedule.cadence == .none ? "No schedule set" : "Off"
            return
        }
        do {
            guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else { reminderStatus = "Disabled in iPhone Settings"; return }
            center.removeAllPendingNotificationRequests()
            func content() -> UNMutableNotificationContent {
                let content = UNMutableNotificationContent()
                content.title = Self.reminderTitle
                content.body = Self.reminderBody
                content.sound = .default
                return content
            }
            switch journal.schedule.cadence {
            case .none:
                reminderStatus = "No schedule set"
                return
            case .weekdays:
                for day in journal.schedule.weekdays.sorted() {
                    let components = DateComponents(hour: journal.schedule.hour, minute: journal.schedule.minute, weekday: day)
                    let request = UNNotificationRequest(identifier: "still-weekday-\(day)", content: content(), trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true))
                    try await center.add(request)
                }
            case .interval, .custom:
                // One-shot reminders: chosen dates do not repeat, and an interval drifts off the calendar week.
                for (index, date) in journal.schedule.occurrences(after: Date(), count: 32).enumerated() {
                    let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                    let request = UNNotificationRequest(identifier: "still-dated-\(index)", content: content(), trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
                    try await center.add(request)
                }
            }
            reminderStatus = "Reminders on"
        } catch { reminderStatus = "Could not schedule reminders"; self.error = error.localizedDescription }
    }
    /// Neutral sample data for demos and screenshots: plain mg doses, a generic medication name, no vial or syringe maths.
    static func demoJournal() -> Journal {
        var journal = Journal()
        journal.medication = "Weekly medication"; journal.medicationModel = .halfLife; journal.halfLifeDays = 7
        journal.schedule.weekdays = [2, 5]
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        journal.goal = WeightGoal(kilograms: 82, date: cal.date(byAdding: .day, value: 60, to: today))
        journal.schedule.startDate = cal.date(byAdding: .day, value: -4, to: today)!
        let values: [Double] = [94.8,94.5,94.7,94.0,93.7,93.9,93.1,92.8,93.0,92.4,92.2,91.8,92.0,91.4,91.2,91.5,90.8,90.6,90.9,90.2,90.0,89.8,89.9,89.4,89.2,89.4,88.9,88.7,88.5]
        journal.weights = values.enumerated().map { i, value in
            WeightEntry(date: cal.date(byAdding: .day, value: (i - values.count + 1) * 2, to: today)!, kilograms: value, note: i == values.count - 1 ? "Feeling more like myself. A long walk this morning." : "")
        }
        journal.doses = (0..<8).map { i in
            DoseEntry(date: cal.date(byAdding: .day, value: -i * 7 - 2, to: today)!, medication: journal.medication, milligrams: 0.5, note: i == 0 ? "Easy morning. Keeping water close today." : "")
        }
        return journal
    }
}
