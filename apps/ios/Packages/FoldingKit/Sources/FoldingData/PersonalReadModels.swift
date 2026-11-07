import FoldingDomain
import Foundation

public enum PersonalReadError: Error, Equatable {
  case changedSnapshot, invalidCursor, invalidRange
}
public struct PersonalSnapshotVersion: Codable, Equatable, Sendable {
  public let cacheSchemaVersion: Int
  public let reducerVersion: Int
  public let journalID: UUID
  public let revision: Int64
  public let generation: ResetGeneration
  public let homeTimezone: String
}
public struct CompactPersonalSnapshot: Sendable {
  public let version: PersonalSnapshotVersion
  public let asOfMS: Int64
  public let range: PersonalDateRange
  public let lifetime: PersonalTotals
  public let days: [PersonalDailySummary]
  public let runningSessions: [TrackingSession]
  public let selectedDeviceID: UUID?
  public let observedDeviceCount: Int
  public var generation: ResetGeneration { version.generation }
  public var needsDeviceSelection: Bool { selectedDeviceID == nil && observedDeviceCount > 1 }
}
public struct PersonalSessionCursor: Codable, Equatable, Sendable {
  let version: PersonalSnapshotVersion
  let range: PersonalDateRangeWire
  let afterStartMS: Int64
  let afterDeviceID: String
  let afterOrdinal: Int64
}
struct PersonalDateRangeWire: Codable, Equatable, Sendable {
  let startMS: Int64
  let endMS: Int64
  init(_ range: PersonalDateRange) {
    startMS = range.startMS
    endMS = range.endMS
  }
}
public struct PersonalSessionPage: Sendable {
  public let version: PersonalSnapshotVersion
  public let sessions: [TrackingSession]
  public let nextCursor: PersonalSessionCursor?
}
public struct PersonalHistoryCursor: Codable, Equatable, Sendable {
  let version: PersonalSnapshotVersion
  let range: PersonalDateRangeWire
  let period: PersonalHistoryPeriod
  let offset: Int
  let asOfMS: Int64
  let nextBinOffset: Int
}
public struct CompactHistoryPage: Sendable {
  public let version: PersonalSnapshotVersion
  public let range: PersonalDateRange
  public let bins: [PersonalHistoryBin]
  public let nextBinOffset: Int?
  public let nextCursor: PersonalHistoryCursor?
  public let canGoNext: Bool
  public let folds: Int
  public let completeDurationMS: Int64
}
struct DerivedRevision: Equatable, Sendable {
  let journalID: UUID
  let revision: Int64
  let rebuildEpoch: Int64
}
struct DerivedHeader: Codable, Sendable {
  let journalID: UUID
  var revision: Int64
  let rebuildEpoch: Int64
  let generation: ResetGeneration
  let homeTimezone: String
  var totals: PersonalTotals
  let selection: PrivateTransferMarker?
  var observedDevices: Set<UUID>
  var firstEventMS: Int64?
  var lastEventMS: Int64?
  var version: PersonalSnapshotVersion {
    PersonalSnapshotVersion(
      cacheSchemaVersion: 1, reducerVersion: TrackingReducer.version, journalID: journalID,
      revision: revision, generation: generation, homeTimezone: homeTimezone)
  }
}
struct DerivedInput: Sendable {
  let revision: DerivedRevision
  let generation: ResetGeneration
  let events: [TrackingEvent]
  let interruptions: [TrackingInterruption]
  let transfers: [PrivateTransferMarker]
}
