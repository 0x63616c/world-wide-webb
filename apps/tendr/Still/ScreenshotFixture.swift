import Foundation

extension Store {
    /// Synthetic journal for App Store screenshots (`--demo --screenshots`): twelve weeks of plain mg doses
    /// titrating 2.5 → 5 → 7.5 mg under a generic medication name, and a realistic, noisy weight journey.
    /// No vials, syringe units or brand names. Deterministic, so every capture looks the same.
    static func screenshotJournal(now: Date = Date(), calendar cal: Calendar = .current) -> Journal {
        var journal = Journal()
        journal.medication = "Weekly medication"
        journal.medicationModel = .halfLife
        journal.halfLifeDays = 7
        journal.unit = .lb
        let today = cal.startOfDay(for: now)
        func day(_ offset: Int, hour: Int, minute: Int) -> Date {
            cal.date(bySettingHour: hour, minute: minute, second: 0, of: cal.date(byAdding: .day, value: offset, to: today)!)!
        }

        // Four weeks at each step; the latest dose was five days ago, so the next is in two.
        let amounts: [Double] = [2.5, 2.5, 2.5, 2.5, 5, 5, 5, 5, 7.5, 7.5, 7.5, 7.5]
        let notes = [0: "First dose. Nervous but fine.", 4: "First week at 5 mg.", 8: "First week at 7.5 mg.", 11: "Felt good. Easy walk after dinner."]
        journal.doses = amounts.enumerated().map { index, milligrams in
            let weeksAgo = amounts.count - 1 - index
            return DoseEntry(date: day(-5 - weeksAgo * 7, hour: 8, minute: 30), medication: journal.medication, milligrams: milligrams, note: notes[index] ?? "", side: index.isMultiple(of: 2) ? .right : .left)
        }
        let firstDose = cal.startOfDay(for: journal.doses[0].date)
        journal.schedule.weekdays = [cal.component(.weekday, from: day(2, hour: 8, minute: 30))]
        journal.schedule.hour = 8
        journal.schedule.minute = 30
        journal.schedule.startDate = firstDose
        journal.schedule.enabled = true

        // It's a journey: weekly pounds lost, including two plateaus and a small regain,
        // plus seeded day-to-day water-weight noise and the odd missed weigh-in.
        let weeklyLoss: [Double] = [2.6, 1.8, 1.1, 0.1, 0.4, 1.7, 1.4, -0.6, 0.2, 1.9, 1.3, 0.8]
        var random = SeededRandom(seed: 0x7E4D_2026)
        let pounds = 2.2046226218
        let days = cal.dateComponents([.day], from: firstDose, to: today).day!
        var weights: [WeightEntry] = []
        for elapsed in 0..<days {
            let week = min(elapsed / 7, weeklyLoss.count - 1)
            let trend = 217 - weeklyLoss.prefix(week).reduce(0, +) - weeklyLoss[week] * Double(elapsed % 7) / 7
            let skipped = elapsed > 0 && elapsed < days - 1 && random.next() < 0.3
            let noise = (random.next() + random.next() + random.next() - 1.5) * 1.1
            guard !skipped else { continue }
            let lbs = elapsed == 0 ? 217.0 : ((trend + noise) * 10).rounded() / 10
            weights.append(WeightEntry(date: day(elapsed - days, hour: 9, minute: 10), kilograms: lbs / pounds))
        }
        weights[weights.count - 1].note = "Back on track after a slow couple of weeks."
        journal.weights = weights
        journal.goal = WeightGoal(kilograms: 185 / pounds, date: cal.date(byAdding: .day, value: 90, to: today))
        journal.weightsStartAtFirstDose = true
        return journal
    }
}

/// SplitMix64, so screenshot data is noisy but identical on every run.
private struct SeededRandom {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    /// A value in [0, 1).
    mutating func next() -> Double {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
    }
}
