import Foundation
import Testing

@testable import FoldingDomain

private let sourceA = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
private let sourceB = UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!
private func ms(_ iso: String) -> Int64 {
  Int64(ISO8601DateFormatter().date(from: iso)!.timeIntervalSince1970 * 1000)
}
private func event(
  _ sequence: Int64, _ state: Transition, _ time: String, device: UUID = sourceA, test: Bool = false
) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: device, sequence: sequence, generation: .initial,
    observedAtMS: ms(time), timezoneID: "UTC", transition: state, isTest: test,
    competitionEpochID: nil)
}
private func snapshot(
  _ events: [TrackingEvent], zone: String = "UTC", at: String = "2026-03-09T12:00:00Z",
  days: Int = 3,
  interruptions: [TrackingInterruption] = [], transfers: [PrivateTransferMarker] = []
) throws -> PersonalAnalyticsSnapshot {
  try PersonalAnalytics.snapshot(
    events: events, interruptions: interruptions, generation: .initial, homeTimezone: zone,
    asOfMS: ms(at),
    range: PersonalDateRange.trailingDays(days, throughMS: ms(at), homeTimezone: zone),
    transferMarkers: transfers)
}

@Test func calendarDurationSplitsAtMidnightAndSpringDST() throws {
  let e = [event(1, .open, "2026-03-08T07:00:00Z"), event(2, .close, "2026-03-09T09:00:00Z")]
  let result = try snapshot(e, zone: "America/Los_Angeles")
  #expect(result.days.map(\.date) == ["2026-03-07", "2026-03-08", "2026-03-09"])
  #expect(result.days.map(\.completeDurationMS) == [3_600_000, 82_800_000, 7_200_000])
  #expect(result.days.map { $0.endMS - $0.startMS } == [86_400_000, 82_800_000, 86_400_000])
  #expect(result.days.map(\.folds) == [1, 0, 1])
  #expect(result.days.map(\.cycles) == [0, 0, 1])
  #expect(
    result.days.reduce(0) { $0 + $1.completeDurationMS } == result.lifetime.completeDurationMS)
}

@Test func fallDSTAndTimezoneRegroupingPreserveElapsedDuration() throws {
  let e = [event(1, .open, "2026-11-01T07:00:00Z"), event(2, .close, "2026-11-02T08:00:00Z")]
  let local = try snapshot(e, zone: "America/Los_Angeles", at: "2026-11-02T12:00:00Z", days: 2)
  #expect(local.days.first?.completeDurationMS == 90_000_000)
  #expect(local.days.first?.endMS == local.days.last?.startMS)
  let utc = try snapshot(e, at: "2026-11-02T12:00:00Z", days: 2)
  #expect(utc.days.map(\.completeDurationMS) == [61_200_000, 28_800_000])
  #expect(local.lifetime == utc.lifetime)
}

@Test func repeatedTransitionsTestsAndRunningDurationStaySeparate() throws {
  let e = [
    event(1, .open, "2026-03-09T00:00:00Z"), event(2, .open, "2026-03-09T01:00:00Z"),
    event(3, .close, "2026-03-09T02:00:00Z"), event(4, .open, "2026-03-09T03:00:00Z", test: true),
    event(5, .open, "2026-03-09T04:00:00Z"),
  ]
  let result = try snapshot(e + [e[0]], days: 1)
  #expect(result.lifetime.folds == 3)
  #expect(result.days[0].folds == 3)
  #expect(result.days[0].cycles == 0)
  #expect(result.days[0].completeDurationMS == 3_600_000)
  #expect(result.days[0].runningDurationMS == 28_800_000)
  #expect(result.sessions.map(\.completeness) == [.incomplete, .candidate, .running])
  #expect(result.countedEventIDs.count == 3)
  #expect(result.includedEventIDs.count == 4)
  let reversed = try snapshot(e.reversed(), days: 1)
  #expect(result.days == reversed.days)
}

@Test func dayQueryRetainsEarlierTransitionContextAndExclusiveEnd() throws {
  let e = [
    event(1, .close, "2026-03-08T22:00:00Z"), event(2, .close, "2026-03-09T01:00:00Z"),
    event(3, .open, "2026-03-09T23:00:00Z"), event(4, .close, "2026-03-10T00:00:00Z"),
  ]
  let result = try snapshot(e, days: 1)
  #expect(result.days[0].folds == 1)
  #expect(result.days[0].completeDurationMS == 3_600_000)
  #expect(result.days[0].cycles == 0)
}

@Test func interruptionDoesNotInventFoldAndNegativeClockHasNoDuration() throws {
  let e = [
    event(1, .open, "2026-03-09T03:00:00Z"), event(2, .close, "2026-03-09T02:00:00Z"),
    event(3, .open, "2026-03-09T04:00:00Z"), event(4, .close, "2026-03-09T05:00:00Z"),
  ]
  let marker = TrackingInterruption(
    interruptionID: UUID(), deviceID: sourceA, generation: .initial,
    afterSequence: 3, reason: .deviceRestart, observedAtMS: ms("2026-03-09T04:30:00Z"))
  let result = try snapshot(e, days: 1, interruptions: [marker])
  #expect(result.days[0].folds == 4)
  #expect(result.days[0].cycles == 0)
  #expect(result.days[0].completeDurationMS == 0)
  #expect(result.days[0].runningDurationMS == 0)
}

@Test func transferExcludesLateInactiveEventsAndResolvesByRevisionThenID() throws {
  let a = [event(1, .open, "2026-03-09T01:00:00Z"), event(2, .close, "2026-03-09T02:00:00Z")]
  let b = [event(1, .open, "2026-03-09T03:00:00Z", device: sourceB)]
  let one = PrivateTransferMarker(
    transferID: sourceA, revision: 1, activeDeviceID: sourceA, sourceWatermarks: [sourceB: 1],
    createdAtMS: 100)
  let two = PrivateTransferMarker(
    transferID: sourceB, revision: 1, activeDeviceID: sourceB, sourceWatermarks: [sourceA: 1],
    createdAtMS: 1)
  let initial = try snapshot(a + b, days: 1)
  #expect(initial.needsDeviceSelection)
  let selected = try snapshot(a + b, days: 1, transfers: [two, one])
  #expect(selected.selectedDeviceID == sourceB)
  #expect(selected.lifetime.folds == 2)
  #expect(selected.sessions.first?.completeness == .incomplete)
  #expect(selected.days[0].completeDurationMS == 0)
  #expect(!selected.includedEventIDs.contains(a[1].eventID))
  let back = PrivateTransferMarker(
    transferID: UUID(), revision: 2, activeDeviceID: sourceA, sourceWatermarks: [sourceB: 1],
    createdAtMS: 0)
  let restored = try snapshot(a + b, days: 1, transfers: [one, two, back])
  #expect(restored.lifetime.folds == 3)
  #expect(restored.days[0].completeDurationMS == 3_600_000)
}

@Test func invalidAnalyticsInputsFailWithoutPartialResults() throws {
  #expect(throws: AnalyticsError.invalidTimezone) { try snapshot([], zone: "Not/AZone") }
  #expect(throws: AnalyticsError.invalidRange) {
    try PersonalDateRange.trailingDays(0, throughMS: 0, homeTimezone: "UTC")
  }
  let one = PrivateTransferMarker(
    transferID: sourceA, revision: 1, activeDeviceID: sourceA, sourceWatermarks: [:], createdAtMS: 1
  )
  let conflict = PrivateTransferMarker(
    transferID: sourceA, revision: 1, activeDeviceID: sourceB, sourceWatermarks: [:], createdAtMS: 1
  )
  #expect(throws: TrackingError.identityConflict) { try snapshot([], transfers: [one, conflict]) }
}

@Test func unorderedEventsRetainExactCalendarAndLifetimeTotals() throws {
  let origin = ms("2026-03-08T00:00:00Z")
  let events = (1...32).map { index in
    TrackingEvent(
      schemaVersion: 1, eventID: UUID(), deviceID: sourceA, sequence: Int64(index),
      generation: .initial,
      observedAtMS: origin + Int64(index) * 3_600_000, timezoneID: "UTC",
      transition: index.isMultiple(of: 2) ? .close : .open,
      isTest: false, competitionEpochID: nil)
  }
  let result = try snapshot(events.reversed(), at: "2026-03-10T12:00:00Z", days: 3)
  #expect(result.lifetime.folds == 32)
  #expect(result.lifetime.cycles == 16)
  #expect(result.lifetime.completeDurationMS == 57_600_000)
  #expect(result.days.reduce(0) { $0 + $1.folds } == 32)
  #expect(result.days.reduce(0) { $0 + $1.completeDurationMS } == 57_600_000)
}
