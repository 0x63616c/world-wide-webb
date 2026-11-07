import Foundation

public enum PersonalHistoryPeriod: Sendable, Equatable { case day, week, month, all }
public struct PersonalHistoryBin: Sendable, Equatable {
  public let startMS: Int64
  public let endMS: Int64
  public let folds: Int
}
public struct PersonalHistorySnapshot: Sendable {
  public let analytics: PersonalAnalyticsSnapshot
  public let bins: [PersonalHistoryBin]
  public let canGoNext: Bool
}

public enum PersonalHistory {
  /// Calendar periods in the selected home zone. Negative offsets select previous periods.
  /// Weeks start Monday. All spans current month and every included observation, including clock-skewed
  /// future observations; no recorded folds silently disappear from the all-time chart.
  /// Every interval is half-open and repeated DST hours keep distinct UTC start/end identities.
  public static func snapshot(
    events: [TrackingEvent], interruptions: [TrackingInterruption], generation: ResetGeneration,
    homeTimezone: String, asOfMS: Int64, period: PersonalHistoryPeriod, offset: Int,
    transferMarkers: [PrivateTransferMarker] = []
  ) throws -> PersonalHistorySnapshot {
    guard (-10000...0).contains(offset), (0...TrackingReducer.maximumInteger).contains(asOfMS),
      period != .all || offset == 0
    else { throw AnalyticsError.invalidRange }
    // Bound timestamps before Calendar conversion; PersonalAnalytics validates the complete envelopes.
    guard events.allSatisfy({ (0...TrackingReducer.maximumInteger).contains($0.observedAtMS) })
    else {
      throw TrackingError.invalidEnvelope
    }
    let transfer = try PrivateTransferPolicy.winner(transferMarkers)
    guard let zone = TimeZone(identifier: homeTimezone) else {
      throw AnalyticsError.invalidTimezone
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    calendar.firstWeekday = 2
    calendar.minimumDaysInFirstWeek = 4
    let now = Date(timeIntervalSince1970: Double(asOfMS) / 1000)
    let component: Calendar.Component
    let grain: Calendar.Component
    switch period {
    case .day:
      component = .day
      grain = .hour
    case .week:
      component = .weekOfYear
      grain = .day
    case .month, .all:
      component = .month
      grain = period == .all ? .month : .day
    }
    guard let selected = calendar.date(byAdding: component, value: offset, to: now),
      let interval = calendar.dateInterval(of: component, for: selected)
    else { throw AnalyticsError.calendarFailure }
    var start = interval.start
    var end = interval.end
    if period == .all {
      let included = events.filter {
        $0.generation == generation && !$0.isTest
          && PrivateTransferPolicy.includes($0, under: transfer)
      }
      let firstMS = min(included.map(\.observedAtMS).min() ?? asOfMS, asOfMS)
      let lastMS = max(included.map(\.observedAtMS).max() ?? asOfMS, asOfMS)
      guard
        let first = calendar.dateInterval(
          of: .month, for: Date(timeIntervalSince1970: Double(firstMS) / 1000)),
        let last = calendar.dateInterval(
          of: .month, for: Date(timeIntervalSince1970: Double(lastMS) / 1000))
      else { throw AnalyticsError.calendarFailure }
      start = first.start
      end = last.end
    }
    func ms(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }
    let range = PersonalDateRange(startMS: ms(start), endMS: ms(end))
    let analytics = try PersonalAnalytics.snapshot(
      events: events, interruptions: interruptions, generation: generation,
      homeTimezone: homeTimezone, asOfMS: asOfMS, range: range, transferMarkers: transferMarkers)
    var bins: [PersonalHistoryBin] = []
    var cursor = start
    while cursor < end {
      guard bins.count < 100000, let bucket = calendar.dateInterval(of: grain, for: cursor),
        bucket.end > cursor
      else { throw AnalyticsError.resultTooLarge }
      bins.append(
        PersonalHistoryBin(
          startMS: ms(cursor), endMS: ms(min(bucket.end, end)),
          folds: 0))
      cursor = bucket.end
    }
    // Calendar.hour intervals can start before cursor during half-hour DST transitions.
    // Assign by the actual contiguous bin boundaries, never by a separately derived hour key.
    var counts = Array(repeating: 0, count: bins.count)
    for event in Set(events)
    where analytics.countedEventIDs.contains(event.eventID) && event.observedAtMS >= range.startMS
      && event.observedAtMS < range.endMS
    {
      var lower = 0
      var upper = bins.count
      while lower < upper {
        let middle = lower + (upper - lower) / 2
        if bins[middle].endMS <= event.observedAtMS { lower = middle + 1 } else { upper = middle }
      }
      guard lower < bins.count, bins[lower].startMS <= event.observedAtMS else {
        throw AnalyticsError.calendarFailure
      }
      counts[lower] += 1
    }
    bins = zip(bins, counts).map {
      PersonalHistoryBin(startMS: $0.0.startMS, endMS: $0.0.endMS, folds: $0.1)
    }
    return PersonalHistorySnapshot(analytics: analytics, bins: bins, canGoNext: offset < 0)
  }
}
