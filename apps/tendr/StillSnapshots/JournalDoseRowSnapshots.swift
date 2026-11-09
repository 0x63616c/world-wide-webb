import SwiftUI
import XCTest
@testable import Still

/// Journal → Doses row (APP-6) with synthetic fixture doses: a trailing Left/Right chip, no chip
/// when the side is unknown, and skipped/planned states.
@MainActor
final class JournalDoseRowSnapshots: XCTestCase {
    func testJournalDoseRow() throws {
        var logged = Array(Store.screenshotJournal().doses.sorted { $0.date > $1.date }.prefix(4))
        logged[3].side = nil
        logged[3].note = ""
        var skipped = logged[1]
        skipped.status = .skipped
        skipped.note = "Travelling."
        var planned = logged[2]
        planned.status = .planned
        planned.side = nil
        planned.note = ""
        try ComponentGallery.render("journal-dose-row", width: 390, test: self) {
            ComponentGallery.Variant("Logged doses (last has no side)") { list(logged) }
            ComponentGallery.Variant("Skipped and planned") { list([skipped, planned]) }
        }
    }

    private func list(_ rows: [DoseEntry]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows) { dose in
                Text(dose.date, format: .dateTime.month(.abbreviated).day().year())
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding(.leading, 16).padding(.top, 6)
                JournalDoseRow(entry: dose)
                    .padding(.vertical, 8).padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
    }
}
