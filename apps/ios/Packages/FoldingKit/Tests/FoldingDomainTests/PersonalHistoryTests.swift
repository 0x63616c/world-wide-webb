import Foundation
import Testing

@testable import FoldingDomain

private let source = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
private func instant(_ value: String) -> Int64 {
  Int64(ISO8601DateFormatter().date(from: value)!.timeIntervalSince1970 * 1000)
}
private func observation(
  _ sequence: Int64, _ transition: Transition, _ at: String,
  device: UUID = source, test: Bool = false, generation: ResetGeneration = .initial
) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: device, sequence: sequence, generation: generation,
    observedAtMS: instant(at), timezoneID: "UTC", transition: transition, isTest: test,
    competitionEpochID: nil)
}
private func history(
  _ events: [TrackingEvent] = [], period: PersonalHistoryPeriod = .day, offset: Int = 0,
  now: String, zone: String = "America/Los_Angeles", generation: ResetGeneration = .initial,
  transfers: [PrivateTransferMarker] = []
) throws -> PersonalHistorySnapshot {
  try PersonalHistory.snapshot(
    events: events, interruptions: [], generation: generation, homeTimezone: zone,
    asOfMS: instant(now), period: period, offset: offset, transferMarkers: transfers)
}

@Test func springHistoryHasTwentyThreeDistinctHourlyBinsAndNoMissingFold() throws {
  let events = [
    observation(1, .open, "2026-03-08T09:30:00Z"), observation(2, .close, "2026-03-08T10:30:00Z"),
  ]
  let result = try history(events, now: "2026-03-08T12:00:00Z")
  #expect(result.bins.count == 23)
  #expect(result.bins.allSatisfy { $0.endMS - $0.startMS == 3_600_000 })
  #expect(result.bins.first?.startMS == instant("2026-03-08T08:00:00Z"))
  #expect(result.bins.last?.endMS == instant("2026-03-09T07:00:00Z"))
  #expect(
    result.bins.filter { $0.folds == 1 }.map(\.startMS) == [
      instant("2026-03-08T09:00:00Z"), instant("2026-03-08T10:00:00Z"),
    ])
  #expect(result.bins.reduce(0) { $0 + $1.folds } == 2)
}

@Test func fallHistoryKeepsBothRepeatedHoursDistinct() throws {
  let events = [
    observation(1, .open, "2026-11-01T08:30:00Z"), observation(2, .close, "2026-11-01T09:30:00Z"),
  ]
  let result = try history(events, now: "2026-11-01T12:00:00Z")
  #expect(result.bins.count == 25)
  #expect(Set(result.bins.map(\.startMS)).count == 25)
  #expect(
    result.bins.filter { $0.folds == 1 }.map(\.startMS) == [
      instant("2026-11-01T08:00:00Z"), instant("2026-11-01T09:00:00Z"),
    ])
  #expect(result.bins.first?.startMS == instant("2026-11-01T07:00:00Z"))
  #expect(result.bins.last?.endMS == instant("2026-11-02T08:00:00Z"))
}

@Test func nonWholeHourTimezoneBinsUseLocalHourBoundaries() throws {
  let event = observation(1, .open, "2026-03-08T18:20:00Z")
  let result = try history([event], now: "2026-03-08T20:00:00Z", zone: "Asia/Kathmandu")
  #expect(result.bins.count == 24)
  #expect(result.bins.first?.startMS == instant("2026-03-08T18:15:00Z"))
  #expect(result.bins.first?.folds == 1)
  #expect(result.bins.last?.endMS == instant("2026-03-09T18:15:00Z"))
}

@Test func calendarWeekAndMonthNavigationPreserveRealBoundaries() throws {
  let week = try history(period: .week, now: "2026-03-09T12:00:00Z")
  #expect(week.bins.count == 7)
  #expect(week.bins.first?.startMS == instant("2026-03-09T07:00:00Z"))
  let previous = try history(period: .week, offset: -1, now: "2026-03-09T12:00:00Z")
  #expect(previous.canGoNext)
  #expect(previous.bins.first?.startMS == instant("2026-03-02T08:00:00Z"))
  #expect(previous.bins.last?.endMS == week.bins.first?.startMS)
  #expect(previous.bins.last.map { $0.endMS - $0.startMS } == 82_800_000)
  let february = try history(period: .month, offset: -1, now: "2024-03-31T12:00:00Z", zone: "UTC")
  #expect(february.bins.count == 29)
  #expect(february.bins.first?.startMS == instant("2024-02-01T00:00:00Z"))
  #expect(february.bins.last?.endMS == instant("2024-03-01T00:00:00Z"))
  #expect(!week.canGoNext)
}

@Test func historicalBinsUseCausalOrderForTiedTimesRepeatsAndTests() throws {
  let events = [
    observation(1, .open, "2026-03-08T23:59:00Z"),
    observation(2, .open, "2026-03-09T00:01:00Z"),
    observation(3, .close, "2026-03-09T01:00:00Z", test: true),
    observation(4, .close, "2026-03-09T02:00:00Z"),
    observation(5, .open, "2026-03-09T02:00:00Z"),
    observation(6, .close, "2026-03-09T02:00:00Z"),
    observation(7, .open, "2026-03-10T00:00:00Z"),
  ]
  let result = try history(
    events.reversed() + [events[3]], now: "2026-03-09T12:00:00Z", zone: "UTC")
  #expect(result.bins[0].folds == 0)
  #expect(result.bins[1].folds == 0)
  #expect(result.bins[2].folds == 3)
  #expect(result.bins.reduce(0) { $0 + $1.folds } == 3)
  #expect(result.analytics.days.reduce(0) { $0 + $1.folds } == 3)
}

@Test func allHistoryIncludesFutureClockMonthButExcludesResetTestAndInactiveHistory() throws {
  let generation = ResetGeneration(revision: 1, resetID: UUID())
  let inactive = UUID()
  let events = [
    observation(1, .open, "2020-01-01T00:00:00Z"),
    observation(2, .open, "2021-01-01T00:00:00Z", test: true, generation: generation),
    observation(1, .open, "2022-01-01T00:00:00Z", device: inactive, generation: generation),
    observation(3, .open, "2026-01-31T23:59:00Z", generation: generation),
    observation(4, .close, "2026-05-01T00:00:00Z", generation: generation),
  ]
  let transfer = PrivateTransferMarker(
    transferID: UUID(), revision: 1, activeDeviceID: source, sourceWatermarks: [:], createdAtMS: 0)
  let result = try history(
    events, period: .all, now: "2026-03-09T12:00:00Z", zone: "UTC", generation: generation,
    transfers: [transfer])
  #expect(result.bins.count == 5)
  #expect(result.bins.first?.startMS == instant("2026-01-01T00:00:00Z"))
  #expect(result.bins.last?.endMS == instant("2026-06-01T00:00:00Z"))
  #expect(result.bins.map(\.folds) == [1, 0, 0, 0, 1])
  #expect(result.bins.reduce(0) { $0 + $1.folds } == result.analytics.lifetime.folds)
  #expect(!result.canGoNext)
}

@Test func emptyAndInvalidHistoryQueriesHaveExplicitBounds() throws {
  let empty = try history(period: .all, now: "2026-03-09T12:00:00Z", zone: "UTC")
  #expect(empty.bins.count == 1)
  #expect(empty.bins[0].folds == 0)
  #expect(throws: AnalyticsError.invalidRange) {
    try history(period: .all, offset: -1, now: "2026-03-09T12:00:00Z")
  }
  #expect(throws: AnalyticsError.invalidRange) {
    try history(offset: 1, now: "2026-03-09T12:00:00Z")
  }
  #expect(throws: AnalyticsError.invalidRange) {
    try PersonalHistory.snapshot(
      events: [], interruptions: [], generation: .initial, homeTimezone: "UTC", asOfMS: -1,
      period: .day, offset: 0)
  }
}

@Test func halfHourDSTTransitionsNeverDropEventsFromShortBins() throws {
  for (now, start, end, expectedBins) in [
    ("2026-10-04T01:00:00Z", "2026-10-03T13:30:00Z", "2026-10-04T13:00:00Z", 24),
    ("2026-04-05T01:00:00Z", "2026-04-04T13:00:00Z", "2026-04-05T13:30:00Z", 25),
  ] {
    let startMS = instant(start)
    let endMS = instant(end)
    let observations = stride(from: startMS, to: endMS, by: 900_000).enumerated().map {
      index, time in
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: Int64(index + 1),
        generation: .initial,
        observedAtMS: time, timezoneID: "Australia/Lord_Howe",
        transition: index.isMultiple(of: 2) ? .open : .close, isTest: false, competitionEpochID: nil
      )
    }
    let result = try history(observations, now: now, zone: "Australia/Lord_Howe")
    #expect(result.bins.count == expectedBins)
    #expect(result.bins.first?.startMS == startMS)
    #expect(result.bins.last?.endMS == endMS)
    #expect(result.bins.reduce(0) { $0 + $1.folds } == observations.count)
    #expect(result.bins.filter { $0.endMS - $0.startMS == 1_800_000 }.count == 1)
    for pair in zip(result.bins, result.bins.dropFirst()) {
      #expect(pair.0.endMS == pair.1.startMS)
    }
    for bin in result.bins {
      #expect(
        bin.folds
          == observations.filter { $0.observedAtMS >= bin.startMS && $0.observedAtMS < bin.endMS }
          .count)
    }
  }
}
