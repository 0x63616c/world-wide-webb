import Foundation

public enum PersonalHistoryPeriod: String, Codable, Sendable, Equatable {
  case day, week, month, all
}
public struct PersonalHistoryBin: Sendable, Equatable {
  public let startMS: Int64
  public let endMS: Int64
  public let folds: Int
  public init(startMS: Int64, endMS: Int64, folds: Int) {
    self.startMS = startMS
    self.endMS = endMS
    self.folds = folds
  }
}
public struct PersonalHistorySnapshot: Sendable {
  public let analytics: PersonalAnalyticsSnapshot
  public let bins: [PersonalHistoryBin]
  public let canGoPrevious: Bool
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
    transferMarkers: [PrivateTransferMarker] = [], deletions: [TrackingDeletion] = []
  ) throws -> PersonalHistorySnapshot {
    let transfer = try PrivateTransferPolicy.winner(transferMarkers)
    let included = events.filter {
      $0.generation == generation && !$0.isTest
        && PrivateTransferPolicy.includes($0, under: transfer)
    }
    let deletedIDs = Set(deletions.flatMap(\.eventIDs))
    let firstEventMS = included.filter { !deletedIDs.contains($0.eventID) }.map(\.observedAtMS)
      .min()
    let layout = try layout(
      homeTimezone: homeTimezone, asOfMS: asOfMS, period: period, offset: offset,
      firstEventMS: firstEventMS,
      lastEventMS: included.map(\.observedAtMS).max())
    let range = layout.range
    var bins = layout.bins
    let analytics = try PersonalAnalytics.snapshot(
      events: events, interruptions: interruptions,
      generation: generation, homeTimezone: homeTimezone, asOfMS: asOfMS, range: range,
      transferMarkers: transferMarkers, deletions: deletions)
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
    return PersonalHistorySnapshot(
      analytics: analytics, bins: bins,
      canGoPrevious: period != .all && firstEventMS.map { $0 < range.startMS } == true,
      canGoNext: firstEventMS == nil ? offset < 0 : range.endMS <= asOfMS)
  }
  public static func layout(
    homeTimezone: String, asOfMS: Int64, period: PersonalHistoryPeriod,
    offset: Int, firstEventMS: Int64?, lastEventMS: Int64?, binOffset: Int = 0, binLimit: Int? = nil
  ) throws
    -> (range: PersonalDateRange, bins: [PersonalHistoryBin])
  {
    guard
      [firstEventMS, lastEventMS].compactMap({ $0 }).allSatisfy({
        (0...TrackingReducer.maximumInteger).contains($0)
      })
    else { throw TrackingError.invalidEnvelope }
    guard (-10000...0).contains(offset), (0...TrackingReducer.maximumInteger).contains(asOfMS),
      period != .all || offset == 0
    else { throw AnalyticsError.invalidRange }
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
    if period != .all, let firstEventMS {
      let earliestDate = Date(timeIntervalSince1970: Double(min(firstEventMS, asOfMS)) / 1000)
      guard let earliest = calendar.dateInterval(of: component, for: earliestDate) else {
        throw AnalyticsError.calendarFailure
      }
      if start < earliest.start {
        start = earliest.start
        end = earliest.end
      }
    }
    if period == .all {
      let firstMS = min(firstEventMS ?? asOfMS, asOfMS)
      let lastMS = max(lastEventMS ?? asOfMS, asOfMS)
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
    var bins: [PersonalHistoryBin] = []
    var cursor = start
    var index = 0
    while cursor < end {
      guard index < 100000, let bucket = calendar.dateInterval(of: grain, for: cursor),
        bucket.end > cursor
      else { throw AnalyticsError.resultTooLarge }
      if index >= binOffset {
        bins.append(
          PersonalHistoryBin(
            startMS: ms(cursor), endMS: ms(min(bucket.end, end)),
            folds: 0))
      }
      cursor = bucket.end
      index += 1
      if let binLimit, bins.count >= binLimit { break }
    }
    return (range, bins)
  }

}
