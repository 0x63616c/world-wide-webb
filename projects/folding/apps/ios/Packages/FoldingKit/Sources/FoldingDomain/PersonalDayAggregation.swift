import Foundation

/// Calendar projection shared by full snapshots and durable/incremental caches.
public enum PersonalDayAggregation {
  public static func days(
    countedEvents: [TrackingEvent], sessions: [TrackingSession],
    homeTimezone: String, range: PersonalDateRange? = nil, asOfMS: Int64? = nil
  ) throws -> [PersonalDailySummary] {
    let calendar = try PersonalAnalytics.calendar(homeTimezone)
    var bins: [Int64: PersonalDailySummary] = [:]
    func key(_ ms: Int64) -> Int64 {
      PersonalAnalytics.milliseconds(calendar.startOfDay(for: PersonalAnalytics.date(ms)))
    }
    func ensure(_ ms: Int64) throws -> Int64 {
      let start = key(ms)
      if bins[start] == nil {
        guard bins.count < 100_000,
          let end = calendar.date(byAdding: .day, value: 1, to: PersonalAnalytics.date(start))
        else { throw AnalyticsError.resultTooLarge }
        let c = calendar.dateComponents([.year, .month, .day], from: PersonalAnalytics.date(start))
        bins[start] = PersonalDailySummary(
          startMS: start, endMS: PersonalAnalytics.milliseconds(end),
          date: String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!),
          timezoneID: homeTimezone)
      }
      return start
    }
    func contains(_ ms: Int64) -> Bool {
      range.map { ($0.startMS..<$0.endMS).contains(ms) } ?? true
    }
    if let range {
      guard range.startMS < range.endMS else { throw AnalyticsError.invalidRange }
      var cursor = key(range.startMS)
      while cursor < range.endMS { cursor = try bins[ensure(cursor)]!.endMS }
    }
    for event in countedEvents where contains(event.observedAtMS) {
      let day = try ensure(event.observedAtMS)
      if event.transition == .open { bins[day]?.opens += 1 } else { bins[day]?.closes += 1 }
    }
    var segments = 0
    for session in sessions {
      if session.completeness == .complete, let end = session.endMS, contains(end) {
        let day = try ensure(end)
        bins[day]?.cycles += 1
      }
      let running = session.completeness == .running
      let end: Int64
      if running, let asOfMS {
        end = asOfMS
      } else if session.durationMS != nil, let closed = session.endMS {
        end = closed
      } else {
        continue
      }
      var cursor = max(session.startMS, range?.startMS ?? session.startMS)
      let stop = min(end, range?.endMS ?? end)
      while cursor < stop {
        segments += 1
        guard segments <= 1_000_000 else { throw AnalyticsError.resultTooLarge }
        let day = try ensure(cursor)
        let next = min(stop, bins[day]!.endMS)
        guard next > cursor else { throw AnalyticsError.calendarFailure }
        let previous = running ? bins[day]!.runningDurationMS : bins[day]!.completeDurationMS
        let (sum, overflow) = previous.addingReportingOverflow(next - cursor)
        guard !overflow else { throw TrackingError.invalidEnvelope }
        if running {
          bins[day]?.runningDurationMS = sum
        } else {
          bins[day]?.completeDurationMS = sum
        }
        cursor = next
      }
    }
    return bins.values.sorted { $0.startMS < $1.startMS }
  }
  public static func merging(_ lhs: PersonalDailySummary, _ rhs: PersonalDailySummary) throws
    -> PersonalDailySummary
  {
    guard lhs.startMS == rhs.startMS, lhs.endMS == rhs.endMS, lhs.timezoneID == rhs.timezoneID
    else { throw AnalyticsError.invalidRange }
    var result = lhs
    result.opens += rhs.opens
    result.closes += rhs.closes
    result.cycles += rhs.cycles
    let (duration, overflow) = lhs.completeDurationMS.addingReportingOverflow(
      rhs.completeDurationMS)
    let (running, runningOverflow) = lhs.runningDurationMS.addingReportingOverflow(
      rhs.runningDurationMS)
    guard !overflow && !runningOverflow else { throw TrackingError.invalidEnvelope }
    result.completeDurationMS = duration
    result.runningDurationMS = running
    return result
  }

}
