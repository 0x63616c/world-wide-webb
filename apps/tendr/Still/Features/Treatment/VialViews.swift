import RDesign
import SwiftUI

struct VialSummary: View {
    @Environment(Store.self) private var store
    var vial: Vial
    var used: Double { store.journal.doses.filter { $0.vialID == vial.id && $0.status == .taken && $0.date <= Date() }.reduce(0) { $0 + $1.milligrams / ($1.concentration ?? vial.concentration) } }
    var remaining: Double { max(0, vial.volumeML - used) }
    var fraction: Double { remaining / vial.volumeML }
    var body: some View {
        HStack(spacing: 16) {
            VialGlyph(fraction: fraction)
            VStack(alignment: .leading, spacing: 4) {
                Text("Current vial").font(.subheadline.weight(.semibold))
                Text("\(fraction, format: .percent.precision(.fractionLength(0))) remaining · \(number(remaining, digits: 2)) of \(number(vial.volumeML)) mL").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(number(vial.concentration)) mg/mL").font(.caption.weight(.medium)).multilineTextAlignment(.trailing).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).card()
        .accessibilityElement(children: .combine)
    }
}
struct VialEditor: View {
    @State private var initialized = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    var vial: Vial?
    @State private var medication = ""
    @State private var received = Date()
    @State private var concentration = ""
    @State private var volume = ""
    @State private var note = ""
    var valid: Bool { parse(concentration).map { $0 > 0 && $0.isFinite } == true && parse(volume).map { $0 > 0 && $0.isFinite } == true && !medication.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var body: some View {
        NavigationStack {
            Form {
                Section("Vial details") {
                    HStack { Text("Medication"); Spacer(); TextField("Name", text: $medication).multilineTextAlignment(.trailing).accessibilityLabel("Medication") }
                    DatePicker("Received", selection: $received, displayedComponents: .date)
                    HStack { Text("Concentration"); Spacer(); TextField("0", text: $concentration).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityLabel("Concentration"); Text("mg/mL").foregroundStyle(.secondary) }
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }.alignmentGuide(.listRowSeparatorTrailing) { $0.width }
                    HStack { Text("Starting volume"); Spacer(); TextField("0", text: $volume).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityLabel("Starting volume"); Text("mL").foregroundStyle(.secondary) }
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }.alignmentGuide(.listRowSeparatorTrailing) { $0.width }
                    if let c = parse(concentration), let v = parse(volume), valid { LabeledContent("Total medication", value: "\(number(c * v, digits: 2)) mg") }
                }
                Section("Notes") { TextField("Optional note", text: $note, axis: .vertical).lineLimit(3...5) }
            }.navigationTitle(vial == nil ? "Add Vial" : "Edit Vial").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save", systemImage: "checkmark") {
                        guard let c = parse(concentration), let v = parse(volume), valid else { return }
                        var updated = Vial(received: received, medication: medication, concentration: c, volumeML: v, note: note)
                        if let vial { updated.id = vial.id }
                        var journal = store.journal
                        journal.vials.removeAll { $0.id == updated.id }; journal.vials.append(updated)
                        if store.commit(journal) { dismiss() }
                    }.disabled(!valid) }
                }
                .onAppear { guard !initialized else { return }; initialized = true; medication = vial?.medication ?? store.journal.medication; if let vial { received = vial.received; concentration = number(vial.concentration, digits: 4); volume = number(vial.volumeML, digits: 3); note = vial.note } }
        }
    }
}
func parse(_ string: String) -> Double? { EntryValidation.number(string) }

struct VialMini: View {
    @Environment(Store.self) private var store
    var vial: Vial
    var remaining: Double { max(0, vial.volumeML - store.journal.doses.filter { $0.vialID == vial.id && $0.status == .taken && $0.date <= Date() }.reduce(0) { $0 + $1.milligrams / ($1.concentration ?? vial.concentration) }) }
    var body: some View {
        VStack(spacing: 0) {
            Text("VIAL").font(.system(size: 9, weight: .bold)).tracking(1.4).foregroundStyle(.secondary)
            Spacer(minLength: 6)
            VialGlyph(fraction: remaining / vial.volumeML)
            Spacer(minLength: 7)
            Text("\(number(remaining, digits: 2)) mL / \(number(vial.volumeML)) mL")
                .font(.system(.caption2, design: .rounded, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }.frame(width: 82, height: 128).card()
        .accessibilityElement(children: .combine)
    }
}

struct VialGlyph: View {
    var fraction: Double
    var body: some View {
            VStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 3).fill(.secondary.opacity(0.45)).frame(width: 24, height: 7)
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: 8).fill(Theme.weight.opacity(0.08))
                    RoundedRectangle(cornerRadius: 7).fill(Theme.weight.opacity(0.65)).frame(height: 51 * max(0, min(1, fraction)))
                    VStack(spacing: 8) { ForEach(0..<4) { _ in Rectangle().fill(.white.opacity(0.35)).frame(width: 8, height: 1).frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 5) } }
                }.frame(width: 34, height: 54).overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.weight.opacity(0.35), lineWidth: 1))
            }
        .accessibilityHidden(true)
    }
}
