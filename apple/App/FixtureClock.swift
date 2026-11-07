import Foundation

/// One fixture instant for live-compositor captures and their repeatability checks.
/// All animated views receive phase zero from the application environment.
enum FixtureClock {
    static let now = ISO8601DateFormatter().date(from: "2026-10-29T17:10:30Z")!
}
