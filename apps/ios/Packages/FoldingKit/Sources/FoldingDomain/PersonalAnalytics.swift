import Foundation

public enum AnalyticsError: Error, Equatable {
  case invalidTimezone
  case invalidRange
  case calendarFailure
  case resultTooLarge
}

/// A half-open UTC interval: start is included, end is excluded. Calendar helpers honor the home zone.
public struct PersonalDateRange: Equatable, Sendable {
  public let startMS: Int64
  public let endMS: Int64
  public init(startMS: Int64, endMS: Int64) {
    self.startMS = startMS
    self.endMS = endMS
  }

  public static func trailingDays(_ count: Int, throughMS: Int64, homeTimezone: String) throws
    -> Self
  {
    guard (1...100_000).contains(count), (0...TrackingReducer.maximumInteger).contains(throughMS)
    else { throw AnalyticsError.invalidRange }
    let calendar = try PersonalAnalytics.calendar(homeTimezone)
    let today = calendar.startOfDay(for: PersonalAnalytics.date(throughMS))
    guard let start = calendar.date(byAdding: .day, value: 1 - count, to: today),
      let end = calendar.date(byAdding: .day, value: 1, to: today)
    else { throw AnalyticsError.calendarFailure }
    return Self(
      startMS: PersonalAnalytics.milliseconds(start), endMS: PersonalAnalytics.milliseconds(end))
  }
}

public struct PersonalDailySummary: Codable, Equatable, Sendable {
  public let startMS: Int64
  public let endMS: Int64
  public let date: String
  public let timezoneID: String
  public internal(set) var opens = 0
  public internal(set) var closes = 0
  public internal(set) var cycles = 0
  public internal(set) var completeDurationMS: Int64 = 0
  public internal(set) var runningDurationMS: Int64 = 0
  public var folds: Int { opens + closes }
  public var equivalentDegrees: Double { Double(folds) * 180 }
  public var equivalentMetres: Double { Double(folds) * .pi * 0.1 }
}

public struct PersonalAnalyticsSnapshot: Sendable {
  public let generation: ResetGeneration
  public let homeTimezone: String
  public let asOfMS: Int64
  public let range: PersonalDateRange
  public let lifetime: TrackingSummary
  public let days: [PersonalDailySummary]
  /// All current-generation sessions, independent of the selected chart interval.
  public let sessions: [TrackingSession]
  /// Eligible non-test events, including repeated-state observations that add no fold.
  public let includedEventIDs: Set<UUID>
  /// Only observations that actually increment the fold total.
  public let countedEventIDs: Set<UUID>
  public let selectedDeviceID: UUID?
  public let observedDeviceIDs: Set<UUID>
  public var needsDeviceSelection: Bool { selectedDeviceID == nil && observedDeviceIDs.count > 1 }
}

public enum PersonalAnalytics {
  public static func snapshot(
    events: [TrackingEvent], interruptions: [TrackingInterruption] = [],
    generation: ResetGeneration,
    homeTimezone: String, asOfMS: Int64, range: PersonalDateRange,
    transferMarkers: [PrivateTransferMarker] = []
  ) throws -> PersonalAnalyticsSnapshot {
    guard (0...TrackingReducer.maximumInteger).contains(asOfMS),
      range.startMS < range.endMS,
      range.startMS >= -TrackingReducer.maximumInteger,
      range.endMS <= TrackingReducer.maximumInteger
    else { throw AnalyticsError.invalidRange }
    _ = try calendar(homeTimezone)
    // Validate the full immutable input before filtering; hidden conflicting history is still invalid.
    let validated = try TrackingReducer.reduce(
      events: events, interruptions: interruptions, generation: generation)
    let selection = try PrivateTransferPolicy.winner(transferMarkers)
    let unique = Array(Set(events)).filter { $0.generation == generation }
    let included = unique.filter { PrivateTransferPolicy.includes($0, under: selection) }
    let includedMarkers = interruptions.filter {
      guard $0.generation == generation, let selection, $0.deviceID != selection.activeDeviceID
      else { return $0.generation == generation }
      return $0.afterSequence <= selection.sourceWatermarks[$0.deviceID, default: 0]
    }
    var lifetime =
      try selection == nil
      ? validated
      : TrackingReducer.reduce(
        events: included, interruptions: includedMarkers, generation: generation)
    // An inactive phone cannot keep a running timer alive beyond its transfer watermark.
    if let selection {
      lifetime.sessions = lifetime.sessions.map {
        guard $0.deviceID != selection.activeDeviceID, $0.completeness == .running else {
          return $0
        }
        return TrackingSession(
          deviceID: $0.deviceID, generation: $0.generation, startMS: $0.startMS, endMS: nil,
          durationMS: nil, completeness: .incomplete)
      }
    }
    var counted: Set<UUID> = []
    for source in Dictionary(grouping: included.filter { !$0.isTest }, by: \.deviceID).values {
      var last: Transition?
      for event in source.sorted(by: { $0.sequence < $1.sequence }) {
        if event.transition != last {
          counted.insert(event.eventID)

        }
        last = event.transition
      }
    }
    let days = try PersonalDayAggregation.days(
      countedEvents: included.filter { counted.contains($0.eventID) }, sessions: lifetime.sessions,
      homeTimezone: homeTimezone, range: range, asOfMS: asOfMS)
    return PersonalAnalyticsSnapshot(
      generation: generation, homeTimezone: homeTimezone, asOfMS: asOfMS, range: range,
      lifetime: lifetime, days: days,
      sessions: lifetime.sessions,
      includedEventIDs: Set(included.filter { !$0.isTest }.map(\.eventID)),
      countedEventIDs: counted,
      selectedDeviceID: selection?.activeDeviceID,
      observedDeviceIDs: Set(unique.filter { !$0.isTest }.map(\.deviceID)))
  }

  static func calendar(_ zone: String) throws -> Calendar {
    guard let timezone = TimeZone(identifier: zone) else { throw AnalyticsError.invalidTimezone }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timezone
    calendar.locale = Locale(identifier: "en_US_POSIX")
    return calendar
  }
  static func date(_ milliseconds: Int64) -> Date {
    Date(timeIntervalSince1970: Double(milliseconds) / 1000)
  }
  static func milliseconds(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1000).rounded())
  }
}
