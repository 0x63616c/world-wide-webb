import Foundation

/// Counts by the user's stable home calendar, never UTC labels or foreground hinge samples.
public struct FoldingActivityPatterns: Sendable, Equatable {
  public let hours: [Int]
  public let weekdays: [Int]  // Monday first.
  public let monthDays: [Int]
  public static func snapshot(events: [TrackingEvent], analytics: PersonalAnalyticsSnapshot) throws
    -> Self
  {
    guard let zone = TimeZone(identifier: analytics.homeTimezone) else {
      throw AnalyticsError.invalidTimezone
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    var hours = Array(repeating: 0, count: 24)
    var weekdays = Array(repeating: 0, count: 7)
    var monthDays = Array(repeating: 0, count: 31)
    var seen = Set<UUID>()
    for event in events
    where analytics.countedEventIDs.contains(event.eventID) && seen.insert(event.eventID).inserted {
      let date = Date(timeIntervalSince1970: Double(event.observedAtMS) / 1000)
      hours[calendar.component(.hour, from: date)] += 1
      weekdays[(calendar.component(.weekday, from: date) + 5) % 7] += 1
      monthDays[calendar.component(.day, from: date) - 1] += 1
    }
    return Self(hours: hours, weekdays: weekdays, monthDays: monthDays)
  }
}
