import Foundation

/// Presentation order deliberately leaves the inbox's priority grouping unchanged.
enum NotificationBannerStack {
    static func ordered(_ groups: [NotificationGroup]) -> [NotificationItem] {
        groups.flatMap(\.items).sorted {
            if $0.createdAt != $1.createdAt { return $0.createdAt > $1.createdAt }
            return $0.id < $1.id
        }
    }

    static func peekCount(_ count: Int) -> Int { min(2, max(0, count - 1)) }
}

enum NotificationBannerGesture {
    static func offset(_ x: Double) -> Double {
        x >= 0 ? x : -24 * (1 - 1 / (1 + abs(x) / 80))
    }

    static func dismisses(x: Double, y: Double, predictedX: Double? = nil) -> Bool {
        guard x > 0, x > abs(y) else { return false }
        return x >= 90 || (x >= 16 && (predictedX ?? x) >= 180)
    }
}
