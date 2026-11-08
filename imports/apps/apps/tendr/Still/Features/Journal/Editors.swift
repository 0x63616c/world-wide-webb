import RDesign
import SwiftUI

struct WeightEditor: View {
    @State private var initialized = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    var entry: WeightEntry?
    @State private var amount = ""
    @State private var date = Date()
    @State private var note = ""
    /// Open when an existing note has text; empty notes stay tucked away behind the placeholder.
    @State private var noteExpanded = false
    @State private var unit: WeightUnit = .lb
    @State private var localError: String?
    var kilograms: Double? { parse(amount).map { unit.kilograms($0) } }
    var valid: Bool { kilograms.map(EntryValidation.weight) ?? false }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(spacing: 18) {
                        Image(systemName: "scalemass.fill").font(.title).foregroundStyle(Theme.weight)
                        TextField("0.0", text: $amount).keyboardType(.decimalPad).font(.system(size: 62, weight: .medium, design: .rounded)).multilineTextAlignment(.center).accessibilityLabel("Weight").accessibilityIdentifier("weightAmount")
                        Text(unit.symbol).font(.subheadline).foregroundStyle(.secondary)
                        if !amount.isEmpty && !valid { Text("Enter a valid weight.").font(.caption).foregroundStyle(Theme.pine) }
                    }.card()
                    VStack(alignment: .leading, spacing: 16) {
                        DatePicker("Date", selection: $date)
                        if date > Date() { Label("Future entry · excluded from current trends", systemImage: "calendar").font(.caption).foregroundStyle(.secondary) }
                        DisclosureGroup("Note", isExpanded: $noteExpanded) { TextField("Tap to add a note…", text: $note, axis: .vertical).lineLimit(2...5).accessibilityIdentifier("noteField") }
                    }.card()
                    if let localError { Text(localError).font(.footnote).foregroundStyle(Theme.pine) }
                }.padding(20)
            }.scrollDismissesKeyboard(.interactively).background(Theme.background).navigationTitle(entry == nil ? "Add Weight" : "Edit Weight").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save Weight", systemImage: "checkmark") { save() }
                            .disabled(!valid).accessibilityIdentifier("saveWeight")
                    }
                    if let entry { ToolbarItem(placement: .topBarTrailing) { DeleteEntryButton { store.delete(weight: entry) } } }
                }
                .onAppear { guard !initialized else { return }; initialized = true; unit = store.journal.unit; if let entry { amount = unit.display(entry.kilograms).formatted(.number.grouping(.never).precision(.fractionLength(0...8))); date = entry.date; note = entry.note }; noteExpanded = !note.isEmpty }
        }
    }
    private func save() {
        guard let kilograms, valid else { return }
        var updated = WeightEntry(date: date, kilograms: kilograms, note: note)
        if let entry { updated.id = entry.id }
        if store.save(weight: updated) { dismiss() } else { localError = store.error; store.error = nil }
    }
}
struct DoseEditor: View {
    var scheduledDate: Date? = nil
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    var entry: DoseEntry?
    @State private var amount = ""
    @State private var initialized = false
    @State private var date = Date()
    @State private var note = ""
    /// Open when an existing note has text; empty notes stay tucked away behind the placeholder.
    @State private var noteExpanded = false
    @State private var status = DoseEntry.Status.taken
    @State private var side: InjectionSide? = .right
    @State private var mode = "mg"
    @State private var vialID: UUID?
    @State private var confirmedU100 = false
    @State private var preferences = false
    @State private var localError: String?
    var vial: Vial? { store.journal.vials.first { $0.id == vialID } }
    var concentration: Double? { entry != nil ? entry?.concentration : vial?.concentration ?? store.journal.concentration }
    var milligrams: Double? {
        if status == .skipped { return 0 }
        guard let value = parse(amount), value.isFinite, value > 0 else { return nil }
        switch mode {
        case "units": guard confirmedU100, let concentration else { return nil }; return value / 100 * concentration
        case "mL": guard let concentration else { return nil }; return value * concentration
        default: return value
        }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let entry {
                        HStack { Image(systemName: "syringe.fill").foregroundStyle(Theme.pine); Text(entry.medication).font(.headline); Spacer() }
                        if let intended = entry.scheduledDate ?? scheduledDate {
                            Label { Text(intended, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()) } icon: { Image(systemName: "calendar") }.font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    if status != .skipped {
                        VStack(spacing: 16) {
                            if FeatureFlags.syringeUnits {
                                Picker("Input unit", selection: Binding(get: { mode }, set: { changeMode($0) })) { Text("mg").tag("mg"); Text("mL").tag("mL"); Text("Units").tag("units") }.pickerStyle(.segmented)
                            }
                            ZStack(alignment: .trailing) {
                                TextField("0", text: $amount).keyboardType(.decimalPad).font(.system(size: 54, weight: .medium, design: .rounded)).multilineTextAlignment(.center).accessibilityLabel("Dose amount").accessibilityIdentifier("doseAmount")
                                Text(mode).font(.title3).foregroundStyle(.secondary)
                            }.padding(.vertical, 10)
                            if mode != "mg", let mg = milligrams { Text("\(number(mg, digits: 4)) mg · \(number((parse(amount) ?? 0) / (mode == "units" ? 100 : 1), digits: 4)) mL").font(.subheadline.weight(.medium)).foregroundStyle(Theme.pine) }
                            if mode == "units" && store.journal.syringeUnitsPerML != 100 {
                                Button("Set up your syringe") { preferences = true }.font(.subheadline)
                            }
                            if mode != "mg" && concentration == nil { Text("Add a vial with its concentration to log in \(mode).").font(.subheadline).foregroundStyle(Theme.pine) }
                        }.card()
                        if entry == nil && !store.journal.vials.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack(spacing: 14) {
                                    if let vial {
                                        VialGlyph(fraction: max(0, vial.volumeML - store.journal.doses.filter { $0.vialID == vial.id && $0.status == .taken && $0.date <= Date() }.reduce(0) { $0 + $1.milligrams / ($1.concentration ?? vial.concentration) }) / vial.volumeML)
                                            .frame(width: 42, alignment: .leading)
                                    }
                                Picker("Vial", selection: $vialID) {
                                    Text("No vial").tag(nil as UUID?)
                                    ForEach(store.journal.vials.sorted { $0.received > $1.received }) { item in Text("\(item.medication) · \(item.received.formatted(date: .abbreviated, time: .omitted))").tag(Optional(item.id)) }
                                }.frame(maxWidth: .infinity, alignment: .leading)
                                }
                                if let concentration { HStack { Text("Concentration"); Spacer(); Text("\(number(concentration, digits: 3)) mg/mL") }.font(.caption).foregroundStyle(.secondary) }
                            }.card()
                        }
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        if status != .skipped { HStack {
                            Text("Injection site")
                            Spacer()
                            Picker("Injection site", selection: $side) {
                                if entry != nil { Text("Unknown").tag(nil as InjectionSide?) }
                                ForEach(InjectionSide.allCases, id: \.self) { Text($0.title).tag(Optional($0)) }
                            }.pickerStyle(.menu).labelsHidden()
                                .accessibilityValue(side?.title ?? "Unknown")
                                .accessibilityIdentifier("injectionSidePicker")
                        } }
                        if entry == nil {
                            DatePicker("Taken at", selection: $date, in: ...Date())
                        } else {
                            DatePicker(status == .planned ? "Planned for" : status == .skipped ? "Skipped date" : "Taken at", selection: $date)
                        }
                        DisclosureGroup("Note", isExpanded: $noteExpanded) { TextField("Tap to add a note…", text: $note, axis: .vertical).lineLimit(2...5).accessibilityIdentifier("noteField") }
                    }.card()
                    if let localError { Text(localError).font(.footnote).foregroundStyle(Theme.pine) }
                }.padding(20)
            }.scrollDismissesKeyboard(.interactively).background(Theme.background).navigationTitle(entry == nil ? "Log Dose" : "Edit Dose").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(entry == nil || status == .taken ? "Save Dose" : "Save", systemImage: "checkmark") { save() }
                            .disabled(milligrams == nil).accessibilityIdentifier("saveDose")
                    }
                    if let entry { ToolbarItem(placement: .topBarTrailing) { DeleteEntryButton { store.delete(dose: entry) } } }
                }
                .sheet(isPresented: $preferences, onDismiss: { confirmedU100 = store.journal.syringeUnitsPerML == 100 }) { DosePreferencesEditor().tendrSheet() }
                .onAppear {
                    guard !initialized else { return }; initialized = true
                    confirmedU100 = store.journal.syringeUnitsPerML == 100
                    if let entry {
                        amount = number(entry.syringeUnits ?? entry.milligrams, digits: 4); mode = entry.syringeUnits != nil ? "units" : "mg"
                        confirmedU100 = entry.syringeUnitsPerML == 100 || confirmedU100
                        // A planned dose being logged gets the suggestion; an unknown historical side stays unknown until chosen.
                        date = entry.date; status = entry.status; note = entry.note; vialID = entry.vialID
                        side = entry.side ?? (entry.status == .planned ? InjectionSide.suggestedNext(in: store.journal.doses.filter { $0.id != entry.id }, startOn: store.journal.injectionStartSide) : nil)
                    } else {
                        vialID = store.journal.vials.sorted { $0.received > $1.received }.first?.id
                        mode = store.journal.doseInputUnit ?? (confirmedU100 && vialID != nil ? "units" : "mg")
                        side = InjectionSide.suggestedNext(in: store.journal.doses, startOn: store.journal.injectionStartSide)
                    }
                    // mg-only entry: entries recorded in units or mL open showing their stored mg.
                    if !FeatureFlags.syringeUnits { mode = "mg"; if let entry { amount = number(entry.milligrams, digits: 4) } }
                    noteExpanded = !note.isEmpty
                }
        }
    }
    func changeMode(_ newMode: String) {
        let original = milligrams
        mode = newMode
        guard let original else { amount = ""; return }
        let converted: Double
        switch newMode {
        case "mL":
            guard let concentration, concentration > 0 else { amount = ""; return }
            converted = original / concentration
        case "units":
            guard confirmedU100, let concentration, concentration > 0 else { amount = ""; return }
            converted = original / concentration * 100
        default: converted = original
        }
        amount = converted.formatted(.number.grouping(.never).precision(.fractionLength(0...8)))
    }
    func save() {
        guard let mg = milligrams else { return }
        var updated = DoseEntry(date: date, scheduledDate: entry?.scheduledDate ?? scheduledDate, medication: entry?.medication ?? vial?.medication ?? store.journal.medication, milligrams: mg, concentration: concentration, status: status, note: note, side: status == .skipped ? nil : side)
        if let entry { updated.id = entry.id }
        updated.vialID = vialID
        if mode == "units" && status != .skipped { updated.syringeUnits = parse(amount); updated.syringeUnitsPerML = 100 }
        // Keep a previously recorded syringe reading while its mg amount is unchanged, so it can return with the feature.
        if !FeatureFlags.syringeUnits, let entry, entry.syringeUnits != nil, abs(entry.milligrams - mg) < 1e-9 {
            updated.syringeUnits = entry.syringeUnits; updated.syringeUnitsPerML = entry.syringeUnitsPerML
        }
        if store.save(dose: updated, inputUnit: FeatureFlags.syringeUnits && entry == nil && status != .skipped ? mode : nil) {
            dismiss()
        } else { localError = store.error; store.error = nil }
    }
}
struct ScheduleEditor: View {
    @State private var initialized = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var days: Set<Int> = []
    @State private var time = Date()
    @State private var reminders = false
    @State private var cadence = ScheduleCadence.weekdays
    @State private var intervalDays = 4
    @State private var startDate = Date()
    @State private var customDays: Set<DateComponents> = []
    @State private var clearing = false

    private var calendar: Calendar { Calendar.current }
    private var customDates: [Date] {
        customDays.compactMap { calendar.date(from: $0).map { calendar.startOfDay(for: $0) } }.sorted()
    }
    private var upcomingCustomDates: [Date] {
        customDates.filter { $0 >= calendar.startOfDay(for: Date()) }
    }
    private var canSave: Bool {
        switch cadence {
        case .weekdays: !days.isEmpty
        case .custom: !customDates.isEmpty
        case .interval, .none: true
        }
    }
    private var hasExistingSchedule: Bool { store.journal.schedule.cadence != .none }

    var body: some View {
        NavigationStack {
            Form {
                Section("Cadence") {
                    Picker("Cadence", selection: $cadence) {
                        Text("Weekdays").tag(ScheduleCadence.weekdays)
                        Text("Every few days").tag(ScheduleCadence.interval)
                        Text("Custom").tag(ScheduleCadence.custom)
                    }.pickerStyle(.segmented).accessibilityIdentifier("cadencePicker")
                }
                switch cadence {
                case .weekdays:
                    Section { ForEach(1...7, id: \.self) { day in
                        Button { if days.contains(day) { days.remove(day) } else { days.insert(day) } } label: {
                            HStack { Text(calendar.weekdaySymbols[day - 1]).foregroundStyle(.primary); Spacer(); if days.contains(day) { Image(systemName: "checkmark").foregroundStyle(Theme.pine) } }
                        }.accessibilityAddTraits(days.contains(day) ? .isSelected : [])
                    } } header: { Text("Days of the week") } footer: { Text("Choose the days in your prescribed schedule. Your actual dose dates can be logged separately.") }
                case .interval:
                    Section("Interval") {
                        Stepper("Every \(intervalDays) days", value: $intervalDays, in: 2...30)
                        DatePicker("Starts", selection: $startDate, displayedComponents: .date)
                    }
                case .custom:
                    Section {
                        MultiDatePicker("Dose dates", selection: $customDays, in: calendar.startOfDay(for: Date())...)
                            .frame(minHeight: 320)
                            .accessibilityIdentifier("customDatePicker")
                    } header: { Text("Pick your dates") } footer: {
                        Text("Tap each day you plan to take your dose. Useful when your gap varies, for example three days then five. Add more whenever you like.")
                    }
                    if !upcomingCustomDates.isEmpty {
                        Section("Upcoming") {
                            ForEach(upcomingCustomDates.prefix(12), id: \.self) { date in
                                HStack {
                                    Text(date, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                                    Spacer()
                                    Button { customDays.remove(calendar.dateComponents([.era, .year, .month, .day], from: date)) } label: {
                                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                    }.buttonStyle(.plain).accessibilityLabel("Remove \(date.formatted(date: .abbreviated, time: .omitted))")
                                }
                            }
                            LabeledContent("Chosen", value: "\(upcomingCustomDates.count)")
                        }
                    }
                case .none:
                    EmptyView()
                }
                Section("Reminders") {
                    Toggle("Remind me", isOn: $reminders)
                    if reminders { DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute) }
                }
                if hasExistingSchedule {
                    Section {
                        Button("Clear schedule", role: .destructive) { clearing = true }
                            .frame(maxWidth: .infinity)
                            .accessibilityIdentifier("clearSchedule")
                    } footer: {
                        Text("Removes all upcoming dose dates and reminders. Doses you have already logged are kept.")
                    }
                }
            }.navigationTitle("Your schedule").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save", systemImage: "checkmark") { save() }.disabled(!canSave) }
                }
                .alert("Clear your schedule?", isPresented: $clearing) {
                    Button("Cancel", role: .cancel) {}
                    Button("Clear", role: .destructive) { if store.clearSchedule() { dismiss() } }
                } message: { Text("You will have no upcoming doses or reminders until you set one again.") }
                .onAppear(perform: load)
        }
    }

    private func load() {
        guard !initialized else { return }; initialized = true
        let schedule = store.journal.schedule
        days = schedule.weekdays
        reminders = schedule.enabled
        cadence = schedule.cadence == .none ? .weekdays : schedule.cadence
        intervalDays = schedule.intervalDays ?? 4
        startDate = schedule.startDate
        customDays = Set(schedule.customDates.map { calendar.dateComponents([.era, .year, .month, .day], from: $0) })
        time = calendar.date(bySettingHour: schedule.hour, minute: schedule.minute, second: 0, of: Date()) ?? Date()
    }

    private func save() {
        var next = store.journal
        // Only the chosen cadence keeps its dates, so switching never leaves a stale rule behind.
        next.schedule.weekdays = cadence == .weekdays ? days : []
        next.schedule.intervalDays = cadence == .interval ? intervalDays : nil
        next.schedule.customDates = cadence == .custom ? customDates : []
        if cadence == .interval { next.schedule.startDate = startDate }
        next.schedule.hour = calendar.component(.hour, from: time)
        next.schedule.minute = calendar.component(.minute, from: time)
        next.schedule.enabled = reminders
        if store.commit(next) { Task { await store.syncReminders() }; dismiss() }
    }
}

struct DeleteEntryButton: View {
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false
    let delete: () -> Bool
    var body: some View {
        Button(role: .destructive) { confirming = true } label: { Label("Delete entry", systemImage: "trash") }
            .accessibilityLabel("Delete entry")
            .alert("Delete this entry?", isPresented: $confirming) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) { if delete() { dismiss() } }
            } message: { Text("This cannot be undone.") }
    }
}

struct DosePreferencesEditor: View {
    @State private var initialized = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var unit = "mg"
    @State private var u100 = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Preferred unit") {
                    Picker("Input unit", selection: $unit) { Text("mg").tag("mg"); Text("mL").tag("mL"); Text("Units").tag("units") }.pickerStyle(.segmented)
                }
                Section {
                    Toggle("I use a U-100 syringe", isOn: $u100)
                } header: { Text("Syringe") } footer: { Text("Check your syringe marking. U-100 means 100 units per mL.") }
            }.navigationTitle("Dose entry").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save", systemImage: "checkmark") {
                        var next = store.journal; next.doseInputUnit = unit; next.syringeUnitsPerML = u100 ? 100 : nil
                        if store.commit(next) { dismiss() }
                    } }
                }
                .onAppear { guard !initialized else { return }; initialized = true; u100 = store.journal.syringeUnitsPerML == 100; unit = store.journal.doseInputUnit ?? (u100 ? "units" : "mg") }
        }
    }
}
