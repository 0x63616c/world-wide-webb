import SwiftUI
import XCTest
@testable import Still

/// Component galleries for design review. Add a test per component; run
/// `scripts/capture-snapshots.sh tendr` or the Component snapshots workflow to get the PNGs.
@MainActor
final class GallerySnapshots: XCTestCase {
    private let calendar = Calendar(identifier: .gregorian)
    private var start: Date { calendar.date(from: DateComponents(year: 2026, month: 11, day: 2))! }

    func testUpcomingDoseDates() throws {
        let weekly = (0..<4).map { calendar.date(byAdding: .day, value: 7 * $0, to: start)! }
        try ComponentGallery.render("upcoming-dose-dates", width: 360, test: self) {
            ComponentGallery.Variant("Four weekly dates") { UpcomingDoseDates(dates: weekly) }
            ComponentGallery.Variant("One date") { UpcomingDoseDates(dates: [start]) }
            ComponentGallery.Variant("Empty") { UpcomingDoseDates(dates: []) }
        }
    }
}
