import RDesign
import SwiftUI

private enum HistoryEntry: Identifiable {
    case weight(WeightEntry), dose(DoseEntry)
    var id: UUID { switch self { case .weight(let e): e.id; case .dose(let e): e.id } }
    var date: Date { switch self { case .weight(let e): e.date; case .dose(let e): e.date } }
    var kind: String { switch self { case .weight: "Weight"; case .dose: "Doses" } }
}

struct JournalView: View {
    @Environment(Store.self) private var store
    @State private var weight: WeightEntry?
    @State private var dose: DoseEntry?
    @State private var deleting: HistoryEntry?
    @State private var adding: String?
    @Binding var filter: String
    private var entries: [HistoryEntry] {
        (store.journal.weights.map(HistoryEntry.weight) + store.journal.doses.map(HistoryEntry.dose))
            .filter { filter == "All" || $0.kind == filter }.sorted { $0.date > $1.date }
    }
    private var days: [Date] { Array(Set(entries.map { Calendar.current.startOfDay(for: $0.date) })).sorted(by: >) }
    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                PageHeader("Journal") {
                    Menu { Button("Weight") { adding = "Weight" }; Button("Dose") { adding = "Dose" } } label: {
                        Image(systemName: "plus.circle.fill").font(.title2)
                    }.frame(width: 44, height: 44).accessibilityLabel("Add entry")
                }.padding(.horizontal, 24)
                List {
                    Section {
                        FilterBar(selection: $filter, options: ["All", "Doses", "Weight"].map { ($0, $0) })
                    }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    ForEach(days, id: \.self) { day in
                        Section(day.formatted(date: .abbreviated, time: .omitted)) {
                            ForEach(entries.filter { Calendar.current.isDate($0.date, inSameDayAs: day) }) { entry in
                                Button { edit(entry) } label: { row(entry) }.buttonStyle(.plain)
                                    .disabled(entry.isHealthKitWeight)
                                    .swipeActions(allowsFullSwipe: false) {
                                        if !entry.isHealthKitWeight { Button("Delete", role: .destructive) { deleting = entry }.tint(Theme.pine) }
                                    }
                                }
                            }
                    }
                    if entries.isEmpty { ContentUnavailableView("No entries yet", systemImage: "book.closed", description: Text("Your doses and weights appear here.")) }
                }
                .scrollContentBackground(.hidden)
            }.tendrReadableWidth().background(Theme.background).tendrRootNavigationBar()
                .sheet(isPresented: Binding(get: { adding != nil }, set: { if !$0 { adding = nil } })) {
                    if adding == "Weight" { WeightEditor().tendrSheet() } else { DoseEditor().tendrSheet() }
                }
                .sheet(item: $weight) { WeightEditor(entry: $0).tendrSheet() }
                .sheet(item: $dose) { DoseEditor(entry: $0).tendrSheet() }
                .alert("Delete this entry?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                    Button("Delete entry", role: .destructive) {
                        guard let deleting else { return }
                        switch deleting {
                        case .weight(let e): store.delete(weight: e)
                        case .dose(let e): store.delete(dose: e)
                        }
                        self.deleting = nil
                    }
                }
        }
    }
    private func edit(_ entry: HistoryEntry) {
        switch entry { case .weight(let e): weight = e; case .dose(let e): dose = e }
    }
    @ViewBuilder private func row(_ entry: HistoryEntry) -> some View {
        switch entry {
        case .dose(let e):
            JournalDoseRow(entry: e).padding(.vertical, 8).contentShape(Rectangle())
        case .weight(let e):
            HStack(spacing: 14) {
                Image(systemName: "scalemass.fill").foregroundStyle(Theme.weight).font(.title2)
                details(title: "\(number(store.journal.unit.display(e.kilograms))) \(store.journal.unit.symbol)", subtitle: e.healthKitID == nil ? (e.date > Date() ? "Planned weight" : "Weight") : "Apple Health · \(e.sourceName ?? "Imported")", note: e.note)
                Spacer(minLength: 4)
                Text(e.date, format: .dateTime.hour().minute()).font(.caption2).foregroundStyle(.secondary)
            }.padding(.vertical, 8).contentShape(Rectangle())
        }
    }

    private func details(title: String, subtitle: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
            if !note.isEmpty {
                Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(3).accessibilityIdentifier("journalNote")
            }
        }
    }
}
private extension HistoryEntry {
    var isHealthKitWeight: Bool {
        if case .weight(let entry) = self { return entry.healthKitID != nil }
        return false
    }
}
struct SettingsView: View {
    @Environment(Store.self) private var store
    @State private var schedule = false
    @State private var treatment = false
    @State private var addingVial = false
    @State private var editingVial: Vial?
    @State private var tipJar = RTipJar.tendr
    @State private var tipping = false
    @State private var thanks: RTipJar.Tip?
    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                PageHeader("Settings").padding(.horizontal, 24)
                Form {
                    Section("Preferences") {
                        Picker("Weight unit", selection: Binding(get: { store.journal.unit }, set: { var next = store.journal; next.unit = $0; _ = store.commit(next) })) { ForEach(WeightUnit.allCases, id: \.self) { Text($0.symbol).tag($0) } }
                        Picker("Weight trend", selection: Binding(get: { store.journal.weightTrend }, set: { var next = store.journal; next.weightTrend = $0; _ = store.commit(next) })) {
                            ForEach(WeightTrendMode.allCases, id: \.self) { Text($0.title).tag($0) }
                        }.accessibilityIdentifier("weightTrendPicker")
                        if FeatureFlags.syringeUnits { Button("Dose entry") { treatment = true } }
                        Picker("Appearance", selection: Binding(get: { store.journal.appearance }, set: { var next = store.journal; next.appearance = $0; _ = store.commit(next) })) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
                        Picker("Start injections on", selection: Binding(get: { store.journal.injectionStartSide }, set: { var next = store.journal; next.injectionStartSide = $0; _ = store.commit(next) })) {
                            ForEach(InjectionSide.allCases, id: \.self) { Text($0.title).tag($0) }
                        }.accessibilityIdentifier("injectionStartSidePicker")
                    }
                    Section {
                        HStack {
                            Button {
                                Task { await store.connectHealthKit() }
                            } label: {
                                HStack {
                                    Label(store.journal.healthKitWeightsEnabled ? "Sync body weight" : "Connect Apple Health", systemImage: "heart.fill")
                                    Spacer()
                                    if store.journal.healthKitWeightsEnabled { Image(systemName: "arrow.clockwise").foregroundStyle(.secondary) }
                                }.contentShape(Rectangle())
                            }.buttonStyle(.borderless)
                            InfoButton(store.journal.healthKitWeightsEnabled
                                       ? "Tendr checks Apple Health for new weights each time you open it. Tap Sync body weight to check now. Read-only: Tendr never writes to Apple Health."
                                       : "Read-only. Tendr reads your body weight and never writes to Apple Health.")
                                .accessibilityIdentifier("appleHealthInfo")
                        }
                        if store.journal.healthKitWeightsEnabled {
                            LabeledContent("Status", value: store.healthKitStatus)
                            LabeledContent("Last synced") {
                                if let synced = store.journal.lastHealthKitSync {
                                    Text(synced, format: .relative(presentation: .named)) + Text(" · ") + Text(synced, format: .dateTime.hour().minute())
                                } else {
                                    Text("Not yet")
                                }
                            }.accessibilityIdentifier("lastHealthSync")
                        }
                    } header: { Text("Apple Health") }
                    Section {
                        HStack(spacing: 2) {
                            Text("Start weights at first dose")
                            InfoButton(store.firstDoseDate == nil
                                       ? "Log your first dose to use this option."
                                       : "Removes weights from before your first dose and filters them from future Apple Health syncs. Apple Health is unchanged.")
                                .accessibilityIdentifier("firstDoseWeightsInfo")
                            Spacer(minLength: 8)
                            // Only the switch is disabled, so the explanation stays reachable.
                            Toggle("Start weights at first dose", isOn: Binding(
                                get: { store.journal.weightsStartAtFirstDose },
                                set: { _ = store.setWeightsStartAtFirstDose($0) }
                            )).labelsHidden().disabled(store.firstDoseDate == nil)
                        }
                        if let firstDoseDate = store.firstDoseDate {
                            LabeledContent("First dose") { Text(firstDoseDate, format: .dateTime.month(.abbreviated).day().year()) }
                        }
                    } header: { Text("Weight history") }
                    if tipJar.phase == .ready {
                        Section {
                            RSupportRow(appName: "Tendr") { tipping = true }
                        }
                    }
                    Section {
                        NavigationLink { PrivacyView() } label: { Label("Privacy & About", systemImage: "lock.shield") }
                    } footer: { RVersionFooter("Tendr") }
                }.scrollContentBackground(.hidden)
            }.tendrReadableWidth().background(Theme.background).tendrRootNavigationBar()
                .task {
                    await tipJar.load()
                    let arguments = ProcessInfo.processInfo.arguments
                    if arguments.contains("--uitest"), arguments.contains("--tip-thanks") { thanks = tipJar.tips[1] }
                    if arguments.contains("--uitest"), let flag = arguments.firstIndex(of: "--tip-outcome"), flag + 1 < arguments.count {
                        tipJar.simulatedOutcome = RTipJar.SimulatedOutcome(rawValue: arguments[flag + 1])
                    }
                }
                .sheet(isPresented: $tipping, onDismiss: {
                    thanks = tipJar.completed
                    tipJar.completed = nil
                }) { RTipJarSheet(jar: tipJar, title: "Support Tendr", prompt: "Enjoying Tendr? Leave a tip.").tendrSheet() }
                .fullScreenCover(item: $thanks) { RTipThanks(tip: $0) }
                .sheet(isPresented: $schedule) { ScheduleEditor().tendrSheet() }
                .sheet(isPresented: $treatment) { DosePreferencesEditor().tendrSheet() }
                .sheet(isPresented: $addingVial) { VialEditor().tendrSheet() }
                .sheet(item: $editingVial) { VialEditor(vial: $0).tendrSheet() }
        }
    }
}
struct TreatmentEditor: View {
    @State private var initialized = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var medication = ""
    @State private var halfLife = 7.0
    @State private var model = MedicationModel.halfLife
    @State private var u100 = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Medication") {
                    TextField("Medication name", text: $medication)
                    HStack { Button("Semaglutide") { medication = "Semaglutide"; halfLife = 7; model = .semaglutide }; Spacer(); Button("Tirzepatide") { medication = "Tirzepatide"; halfLife = 5; model = .tirzepatide } }.font(.caption)
                }
                Section("Estimate model") { Picker("Model", selection: $model) { ForEach(MedicationModel.allCases, id: \.self) { Text($0.title).tag($0) } } }
                if model == .halfLife { Section { Stepper("\(number(halfLife)) days", value: $halfLife, in: 0.5...30, step: 0.5) } header: { Text("Model half-life") } footer: { Text("Used only for the estimate graph. Your dose and schedule are set separately.") } }
                if FeatureFlags.syringeUnits { Section { Toggle("I use a U-100 syringe", isOn: $u100) } header: { Text("Dose entry") } footer: { Text("U-100 means 100 units per mL. Check the marking on your syringe.") } }
            }.navigationTitle("Treatment").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Save", systemImage: "checkmark") { var next = store.journal; next.medication = medication.trimmingCharacters(in: .whitespacesAndNewlines); next.halfLifeDays = halfLife; next.medicationModel = model; if FeatureFlags.syringeUnits { next.syringeUnitsPerML = u100 ? 100 : nil }; if store.commit(next) { dismiss() } }.disabled(medication.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) } }
                .onAppear { guard !initialized else { return }; initialized = true; medication = store.journal.medication; halfLife = store.journal.halfLifeDays; model = store.journal.resolvedMedicationModel; u100 = store.journal.syringeUnitsPerML == 100 }
        }
    }
}
struct PrivacyView: View {
    var body: some View {
        List {
            Section("On this iPhone") { Text("No account, ads, analytics SDKs, or server. Your journal is stored locally. Device backups follow your iPhone settings.") }
            Section("Your health") { Text("Tendr is a journal, not a dosing guide. Medication graphs are simplified estimates, not measured levels. Follow your prescriber's instructions.") }
            Section("Help") {
                RHelpLinks(privacy: AppLinks.privacy, support: AppLinks.support)
            }
            if FeatureFlags.assistantPreview { Section("Assistant") { Text("The assistant is a coming-soon preview. No chat service is connected and no journal data is sent to AI.") } }
        }.navigationTitle("Privacy & About").navigationBarTitleDisplayMode(.inline)
    }
}

/// A Journal dose row: a checkmark, "7.5 mg · Medication" with the time underneath, and a trailing
/// "Left"/"Right" chip when the injection side is known. No "Taken" label: a journal entry is taken
/// unless marked otherwise.
struct JournalDoseRow: View {
    let entry: DoseEntry

    var body: some View {
        let e = entry
        let skipped = e.status == .skipped
        HStack(spacing: 14) {
            Image(systemName: skipped ? "minus.circle" : "checkmark.circle.fill")
                .font(.title2).foregroundStyle(skipped ? Color.secondary : Theme.pine)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(skipped ? "Skipped" : "\(number(e.milligrams, digits: 3)) mg") · \(e.medication)")
                    .font(.subheadline.weight(.semibold))
                (Text(e.status == .planned ? "Planned · " : "") + Text(e.date, format: .dateTime.hour().minute()))
                    .font(.caption).foregroundStyle(.secondary)
                if !e.note.isEmpty {
                    Text(e.note).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                        .accessibilityIdentifier("journalNote").padding(.top, 2)
                }
            }
            Spacer(minLength: 4)
            if let side = e.side, !skipped {
                Text(side == .left ? "Left" : "Right").font(.caption.weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.sage, in: Capsule())
                    .accessibilityLabel(side.accessibilityName)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
