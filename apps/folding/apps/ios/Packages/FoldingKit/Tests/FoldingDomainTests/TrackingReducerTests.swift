import Foundation
import Testing

@testable import FoldingDomain

private struct FixtureFile: Decodable {
  let cases: [Fixture]
}
private struct Fixture: Decodable {
  let name: String
  let eventsInArrivalOrder: [TrackingEvent]
  let interruptions: [TrackingInterruption]?
  let expected: Expected
  enum CodingKeys: String, CodingKey {
    case name, interruptions, expected
    case eventsInArrivalOrder = "events_in_arrival_order"
  }
}
private struct Expected: Decodable {
  let folds: Int
  let opens: Int
  let closes: Int
  let cycles: Int
  let completeDurationMS: Int64
  let incompleteSessions: Int
  enum CodingKeys: String, CodingKey {
    case folds, opens, closes, cycles
    case completeDurationMS = "complete_duration_ms"
    case incompleteSessions = "incomplete_sessions"
  }
}

private func fixtures() throws -> [Fixture] {
  // Resolve from this committed source, never from the shell's working directory.
  var root = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { root.deleteLastPathComponent() }
  return try JSONDecoder().decode(
    FixtureFile.self,
    from: Data(contentsOf: root.appendingPathComponent("contracts/fixtures/reducer.json"))
  ).cases
}

@Test func sharedReducerContract() throws {
  for fixture in try fixtures() {
    for observations in [
      fixture.eventsInArrivalOrder, fixture.eventsInArrivalOrder.reversed().map { $0 },
    ] {
      let actual = try TrackingReducer.reduce(
        events: observations,
        interruptions: fixture.interruptions ?? [], generation: .initial)
      let expected = fixture.expected
      #expect(actual.folds == expected.folds, "\(fixture.name)")
      #expect(actual.opens == expected.opens, "\(fixture.name)")
      #expect(actual.closes == expected.closes, "\(fixture.name)")
      #expect(actual.cycles == expected.cycles, "\(fixture.name)")
      #expect(actual.completeDurationMS == expected.completeDurationMS, "\(fixture.name)")
      #expect(actual.incompleteSessions == expected.incompleteSessions, "\(fixture.name)")
    }
  }
}

private func observation(
  _ sequence: Int64, _ transition: Transition, at: Int64,
  id: UUID = UUID(), device: UUID = deviceID,
  generation: ResetGeneration = .initial
) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: id, deviceID: device, sequence: sequence,
    generation: generation, observedAtMS: at, timezoneID: "UTC", transition: transition,
    isTest: false, competitionEpochID: nil)
}
private let deviceID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!

@Test func identitiesCannotChangeOnRetry() throws {
  let id = UUID()
  let open = observation(1, .open, at: 1, id: id)
  #expect(throws: TrackingError.identityConflict) {
    try TrackingReducer.reduce(
      events: [open, observation(1, .close, at: 1, id: id)], generation: .initial)
  }
  #expect(throws: TrackingError.sequenceConflict) {
    try TrackingReducer.reduce(events: [open, observation(1, .open, at: 1)], generation: .initial)
  }
}

@Test func sourcesNeverShareSessionsAndResetExcludesHistory() throws {
  let old = observation(1, .open, at: 10)
  let other = observation(1, .close, at: 20, device: UUID())
  let separate = try TrackingReducer.reduce(events: [old, other], generation: .initial)
  #expect(separate.folds == 2)
  #expect(separate.cycles == 0)
  #expect(separate.completeDurationMS == 0)
  #expect(separate.sessions.first?.completeness == .running)
  let reset = ResetGeneration(revision: 1, resetID: UUID())
  let after = observation(2, .close, at: 30, generation: reset)
  let result = try TrackingReducer.reduce(events: [old, other, after], generation: reset)
  #expect(result.folds == 1)
  #expect(result.sessions.isEmpty)
}

@Test func malformedRangeAndGenerationAreRejected() {
  #expect(throws: TrackingError.invalidEnvelope) {
    try TrackingReducer.reduce(events: [observation(0, .open, at: 1)], generation: .initial)
  }
  #expect(throws: TrackingError.invalidEnvelope) {
    try TrackingReducer.reduce(
      events: [], generation: ResetGeneration(revision: 0, resetID: UUID()))
  }
}

@Test func wireUUIDsAreCanonicalAndNullableEpochIsPresent() throws {
  let event = observation(1, .open, at: 1)
  let data = try JSONEncoder().encode(event)
  let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  #expect(json["event_id"] as? String == event.eventID.uuidString.lowercased())
  #expect(json["competition_epoch_id"] is NSNull)
  #expect(try JSONDecoder().decode(TrackingEvent.self, from: data) == event)
}

@Test func resetOrderIgnoresWallClock() {
  let low = ResetGeneration(
    revision: 1, resetID: UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000000")!)
  let high = ResetGeneration(
    revision: 1, resetID: UUID(uuidString: "bbbbbbbb-0000-0000-0000-000000000000")!)
  #expect(ResetGeneration.initial < low)
  #expect(low < high)
  #expect(high < ResetGeneration(revision: 2, resetID: low.resetID))
}

@Test func sharedTimezonePolicyMatchesFoundationAndWireValidity() throws {
  struct Cases: Decodable { let cases: [Entry] }
  struct Entry: Decodable {
    let timezoneID: String
    let foundationIdentifier: String?
    let valid: Bool
    enum CodingKeys: String, CodingKey {
      case timezoneID = "timezone_id"
      case foundationIdentifier = "foundation_identifier"
      case valid
    }
  }
  var root = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { root.deleteLastPathComponent() }
  let cases = try JSONDecoder().decode(
    Cases.self,
    from: Data(contentsOf: root.appendingPathComponent("contracts/fixtures/timezones.json"))
  ).cases
  for entry in cases {
    #expect(TimeZone(identifier: entry.timezoneID)?.identifier == entry.foundationIdentifier)
    let event = TrackingEvent(
      schemaVersion: 1, eventID: UUID(), deviceID: UUID(), sequence: 1, generation: .initial,
      observedAtMS: 1, timezoneID: entry.timezoneID, transition: .open, isTest: false,
      competitionEpochID: nil)
    if entry.valid {
      #expect(try TrackingReducer.reduce(events: [event], generation: .initial).folds == 1)
    } else {
      #expect(throws: TrackingError.invalidEnvelope) {
        try TrackingReducer.reduce(events: [event], generation: .initial)
      }
    }
  }
}
