import Foundation
import Testing

@testable import FoldingDomain

@Test func foldingPatternsRespectHomeZoneAndDoNotCountDuplicatesOrRepeatedStates() throws {
  let source = UUID()
  let time = Int64(
    ISO8601DateFormatter().date(from: "2026-11-03T01:00:00Z")!.timeIntervalSince1970 * 1000)
  func event(_ seq: Int64, _ transition: Transition) -> TrackingEvent {
    TrackingEvent(
      schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: seq, generation: .initial,
      observedAtMS: time + seq * 1000, timezoneID: "UTC", transition: transition, isTest: false,
      competitionEpochID: nil)
  }
  let first = event(1, .open)
  let events = [first, first, event(2, .open), event(3, .close)]
  let analytics = try PersonalAnalytics.snapshot(
    events: events, generation: .initial,
    homeTimezone: "America/Los_Angeles", asOfMS: time + 10_000,
    range: PersonalDateRange(startMS: time - 86_400_000, endMS: time + 86_400_000))
  let patterns = try FoldingActivityPatterns.snapshot(events: events, analytics: analytics)
  #expect(patterns.hours[17] == 2)
  #expect(patterns.weekdays[0] == 2)  // Monday November 2 at home, Tuesday in UTC.
  #expect(patterns.monthDays[1] == 2)
  #expect(patterns.hours.reduce(0, +) == 2)
}
