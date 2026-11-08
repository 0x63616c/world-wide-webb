import RDesign
import SwiftUI

struct GoalCard: View {
    @Environment(Store.self) private var store
    @State private var editing = false
    var actual: [WeightEntry] { store.treatmentWeights.filter { $0.date <= Date() }.sorted { $0.date < $1.date } }
    var body: some View {
        Button { editing = true } label: {
            VStack(alignment: .leading, spacing: 14) {
                HStack { Label("Goal", systemImage: "scope").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.pine); Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }
                if let goal = store.journal.goal {
                    if let first = actual.first, let latest = actual.last {
                        let distance = first.kilograms - goal.kilograms
                        let progress = abs(distance) > 0.01 ? (first.kilograms - latest.kilograms) / distance : 1
                        HStack(alignment: .bottom) {
                            goalValue("STARTING", kilograms: first.kilograms, alignment: .leading)
                            Spacer()
                            goalValue("GOAL", kilograms: goal.kilograms, alignment: .trailing)
                        }
                        ProgressView(value: min(1, max(0, progress))).tint(Theme.pine)
                        HStack {
                            Text("\(Int((min(1, max(0, progress)) * 100).rounded()))%")
                            Spacer()
                            Text("\(number(store.journal.unit.display(abs(latest.kilograms - goal.kilograms)))) \(store.journal.unit.symbol) to go")
                        }.font(.caption).foregroundStyle(.secondary)
                    } else {
                        goalValue("GOAL", kilograms: goal.kilograms, alignment: .leading)
                    }
                } else { Text("Set a weight goal").font(.headline) }
            }.card()
        }.buttonStyle(.plain).sheet(isPresented: $editing) { GoalEditor().tendrSheet() }
    }
    func goalValue(_ label: String, kilograms: Double, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            Text(label).font(.system(size: 9, weight: .bold)).tracking(1.2).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(number(store.journal.unit.display(kilograms))).font(.system(size: 24, weight: .bold, design: .rounded))
                Text(store.journal.unit.symbol).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
struct GoalEditor: View {
    @State private var initialized = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var hasDate = false
    @State private var date = Calendar.current.date(byAdding: .month, value: 3, to: Date())!
    var goal: WeightGoal? { guard let value = parse(amount), EntryValidation.weight(store.journal.unit.kilograms(value)) else { return nil }; return WeightGoal(kilograms: store.journal.unit.kilograms(value), date: hasDate ? date : nil) }
    var actual: [WeightEntry] { store.treatmentWeights.filter { $0.date <= Date() }.sorted { $0.date < $1.date } }
    var body: some View {
        NavigationStack {
            Form {
                Section("Goal weight") { HStack { TextField("Weight", text: $amount).keyboardType(.decimalPad); Text(store.journal.unit.symbol).foregroundStyle(.secondary) }; Toggle("Target date", isOn: $hasDate); if hasDate { DatePicker("Date", selection: $date, in: Date()..., displayedComponents: .date) } }
                if let goal, let current = actual.last {
                    Section("The pace") {
                        if let required = goal.requiredWeeklyChange(current: current.kilograms, now: Date()) {
                            LabeledContent("Required change", value: "\(number(store.journal.unit.display(required))) \(store.journal.unit.symbol)/week")
                            if required < -0.907185 { Text("This requires more than 2 lbs/week. Consider a later date with your care team.").font(.footnote).foregroundStyle(Theme.pine) }
                        }
                        let recent = actual.filter { $0.date > Date().addingTimeInterval(-28 * 86400) }
                        let summary = WeightSummary(entries: recent, now: Date())
                        if recent.count >= 3, let first = recent.first, let last = recent.last, last.date.timeIntervalSince(first.date) >= 7 * 86400, let weekly = summary.weeklyChange {
                            LabeledContent("Recent pace", value: "\(number(store.journal.unit.display(weekly))) \(store.journal.unit.symbol)/week")
                            if hasDate {
                                let projection = current.kilograms + weekly * date.timeIntervalSince(current.date) / (7 * 86400)
                                if EntryValidation.weight(projection) { LabeledContent("At that pace on your date", value: "~\(number(store.journal.unit.display(projection))) \(store.journal.unit.symbol)") }
                            }
                        } else { Text("Log at least 3 weights across a week for a recent-pace estimate.").font(.footnote).foregroundStyle(.secondary) }
                    }
                    Section { Text("Projections extend your recent trend; they cannot predict treatment response. Weight changes are not linear.").font(.footnote).foregroundStyle(.secondary) }
                }
            }.navigationTitle("Weight Goal").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Save", systemImage: "checkmark") { guard let goal else { return }; var next = store.journal; next.goal = goal; if store.commit(next) { dismiss() } }.disabled(goal == nil) } }
                .onAppear { guard !initialized else { return }; initialized = true; if let goal = store.journal.goal { amount = number(store.journal.unit.display(goal.kilograms), digits: 2); hasDate = goal.date != nil; if let goalDate = goal.date { date = max(Date(), goalDate) } } }
        }
    }
}
