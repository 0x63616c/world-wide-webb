import Foundation

public enum WeightUnit: String, Codable, CaseIterable, Sendable {
    case kg, lb
    public var symbol: String { self == .lb ? "lbs" : "kg" }
    public func display(_ kilograms: Double) -> Double { self == .kg ? kilograms : kilograms * 2.2046226218 }
    public func kilograms(_ value: Double) -> Double { self == .kg ? value : value / 2.2046226218 }
}
public struct Journal: Codable, Equatable, Sendable {
    public var version = 1
    public var goal: WeightGoal?
    public var vials: [Vial] = []
    public var doseInputUnit: String?
    public var injectionStartSide: InjectionSide = .right
    public var syringeUnitsPerML: Double?
    public var halfLifeDays: Double = 7
    public var medicationModel: MedicationModel?
    public var resolvedMedicationModel: MedicationModel { medicationModel ?? MedicationModel.inferred(from: medication) }
    public var appearance = "system"
    public var weightTrend = WeightTrendMode.default
    public var healthKitWeightsEnabled = false
    public var lastHealthKitSync: Date?
    public var weightsStartAtFirstDose = false
    public var weights: [WeightEntry] = []
    public var doses: [DoseEntry] = []
    public var medication = "Semaglutide"
    public var concentration: Double?
    public var containerML: Double?
    public var unit: WeightUnit = .lb
    public var schedule = DoseSchedule()
    public init() {}
    private enum CodingKeys: String, CodingKey { case medicationModel, doseInputUnit, injectionStartSide, version, goal, vials, syringeUnitsPerML, halfLifeDays, appearance, weightTrend, healthKitWeightsEnabled, lastHealthKitSync, weightsStartAtFirstDose, weights, doses, medication, concentration, containerML, unit, schedule }
    public init(from decoder: Decoder) throws {
        self.init()
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
        guard version == 1 else { throw TrackingError.invalidFile }
        medicationModel = try values.decodeIfPresent(MedicationModel.self, forKey: .medicationModel)
        doseInputUnit = try values.decodeIfPresent(String.self, forKey: .doseInputUnit)
        injectionStartSide = try values.decodeIfPresent(InjectionSide.self, forKey: .injectionStartSide) ?? .right
        if let value = try values.decodeIfPresent(WeightGoal.self, forKey: .goal) { goal = value }
        if let value = try values.decodeIfPresent([Vial].self, forKey: .vials) { vials = value }
        if let value = try values.decodeIfPresent(Double.self, forKey: .syringeUnitsPerML) { syringeUnitsPerML = value }
        if let value = try values.decodeIfPresent(Double.self, forKey: .halfLifeDays) { halfLifeDays = value }
        if let value = try values.decodeIfPresent(String.self, forKey: .appearance) { appearance = value }
        // Unknown modes from a newer version fall back rather than failing the whole journal.
        if let value = try values.decodeIfPresent(String.self, forKey: .weightTrend) { weightTrend = WeightTrendMode(rawValue: value) ?? .default }
        healthKitWeightsEnabled = try values.decodeIfPresent(Bool.self, forKey: .healthKitWeightsEnabled) ?? false
        lastHealthKitSync = try values.decodeIfPresent(Date.self, forKey: .lastHealthKitSync)
        weightsStartAtFirstDose = try values.decodeIfPresent(Bool.self, forKey: .weightsStartAtFirstDose) ?? false
        if let value = try values.decodeIfPresent([WeightEntry].self, forKey: .weights) { weights = value }
        if let value = try values.decodeIfPresent([DoseEntry].self, forKey: .doses) { doses = value }
        if let value = try values.decodeIfPresent(String.self, forKey: .medication) { medication = value }
        if let value = try values.decodeIfPresent(Double.self, forKey: .concentration) { concentration = value }
        if let value = try values.decodeIfPresent(Double.self, forKey: .containerML) { containerML = value }
        if let value = try values.decodeIfPresent(WeightUnit.self, forKey: .unit) { unit = value }
        if let value = try values.decodeIfPresent(DoseSchedule.self, forKey: .schedule) { schedule = value }
    }

    public var firstTakenDoseDate: Date? {
        doses.lazy.filter { $0.status == .taken }.map(\.date).min()
    }

    public mutating func applyWeightHistoryStart() {
        guard weightsStartAtFirstDose, let firstTakenDoseDate else { return }
        weights.removeAll { $0.date < firstTakenDoseDate }
    }
}
public struct JournalFile {
    public let url: URL
    public init(url: URL) { self.url = url }
    public func save(_ journal: Journal) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(journal)
        try data.write(to: url, options: .atomic)
    }
    /// Uses the journal's persisted schema so an export retains every record and preference.
    public static func export(_ journal: Journal) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(journal)
    }
    public func load() throws -> Journal {
        guard FileManager.default.fileExists(atPath: url.path) else { return Journal() }
        return try JSONDecoder().decode(Journal.self, from: Data(contentsOf: url))
    }
}

public extension Journal {
    /// The recent typical dose, used only to draw what the schedule implies. Never recorded.
    var typicalDoseMilligrams: Double? {
        let recent = doses
            .filter { $0.status == .taken && $0.milligrams.isFinite && $0.milligrams > 0 && $0.medication.caseInsensitiveCompare(medication) == .orderedSame }
            .sorted { $0.date > $1.date }
            .prefix(3)
            .map(\.milligrams)
        guard !recent.isEmpty else { return nil }
        return recent.reduce(0, +) / Double(recent.count)
    }

    /// Placeholder doses for upcoming scheduled dates, so the projection shows what is coming.
    /// These are estimates at your usual amount, not entries, and a date you have already
    /// logged or explicitly planned keeps its own record instead.
    func scheduledProjection(from now: Date, through end: Date, calendar: Calendar = .current) -> [DoseEntry] {
        guard schedule.cadence != .none, end > now, let milligrams = typicalDoseMilligrams else { return [] }
        return schedule.occurrences(after: now, count: 64, calendar: calendar)
            .prefix { $0 <= end }
            .filter { occurrence in
                !doses.contains { calendar.isDate($0.date, inSameDayAs: occurrence) }
            }
            .map { DoseEntry(date: $0, scheduledDate: $0, medication: medication, milligrams: milligrams, concentration: concentration, status: .planned) }
    }
}
