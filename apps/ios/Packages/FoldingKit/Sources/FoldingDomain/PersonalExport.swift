import Foundation

public enum ExportUploadState: String, Codable, Sendable {
  case notEnrolled = "not_enrolled"
  case pending, acknowledged, rejected, unknown
}

/// Pure serialization result; FoldingData owns the snapshot transaction, file protection and reset fence.
public struct PersonalExportDocument: Encodable, Sendable {
  public let exportedAtMS: Int64
  public let generation: ResetGeneration
  public let homeTimezone: String
  public let events: [PersonalExportEvent]
  public let interruptions: [TrackingInterruption]
  public let transferMarkers: [PrivateTransferMarker]
  public let sessions: [PersonalExportSession]
  public let dailySummaries: [PersonalExportDay]

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case exportedAtMS = "exported_at_ms"
    case generation
    case homeTimezone = "home_timezone"
    case reducerVersion = "reducer_version"
    case travelFormula = "travel_formula"
    case events, interruptions
    case transferMarkers = "transfer_markers"
    case sessions
    case dailySummaries = "daily_summaries"
  }
  struct Formula: Encodable {
    let version = 1
    let degreesPerFold = 180
    let radiusMetres = 0.1
    enum CodingKeys: String, CodingKey {
      case version
      case degreesPerFold = "degrees_per_fold"
      case radiusMetres = "radius_metres"
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(1, forKey: .schemaVersion)
    try c.encode(exportedAtMS, forKey: .exportedAtMS)
    try c.encode(generation, forKey: .generation)
    try c.encode(homeTimezone, forKey: .homeTimezone)
    try c.encode(TrackingReducer.version, forKey: .reducerVersion)
    try c.encode(Formula(), forKey: .travelFormula)
    try c.encode(events, forKey: .events)
    try c.encode(interruptions, forKey: .interruptions)
    try c.encode(transferMarkers, forKey: .transferMarkers)
    try c.encode(sessions, forKey: .sessions)
    try c.encode(dailySummaries, forKey: .dailySummaries)
  }
}

public struct PersonalExportEvent: Encodable, Sendable {
  public let event: TrackingEvent
  public let includedInSummary: Bool
  public let excludedSource: Bool
  public let publicUploadState: ExportUploadState
  enum CodingKeys: String, CodingKey {
    case includedInSummary = "included_in_summary"
    case excludedSource = "excluded_source"
    case publicUploadState = "public_upload_state"
  }
  public func encode(to encoder: Encoder) throws {
    try event.encode(to: encoder)
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(includedInSummary, forKey: .includedInSummary)
    try c.encode(excludedSource, forKey: .excludedSource)
    try c.encode(publicUploadState, forKey: .publicUploadState)
  }
}

public struct PersonalExportSession: Encodable, Sendable {
  public let deviceID: UUID
  public let startMS: Int64
  public let endMS: Int64?
  public let completeDurationMS: Int64?
  public let completeness: SessionCompleteness
  enum CodingKeys: String, CodingKey {
    case deviceID = "device_id"
    case startMS = "start_ms"
    case endMS = "end_ms"
    case completeDurationMS = "complete_duration_ms"
    case completeness
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(deviceID.uuidString.lowercased(), forKey: .deviceID)
    try c.encode(startMS, forKey: .startMS)
    try c.encode(endMS, forKey: .endMS)
    try c.encode(completeDurationMS, forKey: .completeDurationMS)
    try c.encode(completeness, forKey: .completeness)
  }
}

public struct PersonalExportDay: Encodable, Sendable {
  public let date: String
  public let timezoneID: String
  public let folds: Int
  public let opens: Int
  public let closes: Int
  public let cycles: Int
  public let completeDurationMS: Int64
  public let equivalentDegrees: Double
  public let equivalentMetres: Double
  enum CodingKeys: String, CodingKey {
    case date
    case timezoneID = "timezone_id"
    case folds, opens, closes, cycles
    case completeDurationMS = "complete_duration_ms"
    case equivalentDegrees = "equivalent_degrees"
    case equivalentMetres = "equivalent_metres"
  }
}

public struct PersonalExportFile: Sendable {
  public let name: String
  public let data: Data
}

public enum PersonalExport {
  public static func document(
    events: [TrackingEvent], interruptions: [TrackingInterruption] = [],
    transferMarkers: [PrivateTransferMarker] = [],
    generation: ResetGeneration, homeTimezone: String, exportedAtMS: Int64,
    uploadStates: [UUID: ExportUploadState] = [:], excludedEventIDs: Set<UUID> = [],
    deletions: [TrackingDeletion] = []
  ) throws -> PersonalExportDocument {
    guard (0...TrackingReducer.maximumInteger).contains(exportedAtMS) else {
      throw AnalyticsError.invalidRange
    }
    _ = try TrackingReducer.reduce(
      events: events, interruptions: interruptions, generation: generation)
    let cal = try PersonalAnalytics.calendar(homeTimezone)
    let deletedIDs = Set(deletions.flatMap(\.eventIDs))
    let retained = Array(
      Set(events.filter { $0.generation == generation && !deletedIDs.contains($0.eventID) })
    ).sorted {
      if $0.deviceID != $1.deviceID { return $0.deviceID.uuidString < $1.deviceID.uuidString }
      return $0.sequence < $1.sequence
    }
    let first = min(retained.map(\.observedAtMS).min() ?? exportedAtMS, exportedAtMS)
    let last = max(retained.map(\.observedAtMS).max() ?? exportedAtMS, exportedAtMS)
    let start = cal.startOfDay(for: PersonalAnalytics.date(first))
    guard
      let end = cal.date(
        byAdding: .day, value: 1, to: cal.startOfDay(for: PersonalAnalytics.date(last)))
    else { throw AnalyticsError.calendarFailure }
    let snapshot = try PersonalAnalytics.snapshot(
      events: events.filter { !excludedEventIDs.contains($0.eventID) },
      interruptions: interruptions, generation: generation,
      homeTimezone: homeTimezone, asOfMS: exportedAtMS,
      range: PersonalDateRange(
        startMS: PersonalAnalytics.milliseconds(start), endMS: PersonalAnalytics.milliseconds(end)),
      transferMarkers: transferMarkers, deletions: deletions)
    let selected = try PrivateTransferPolicy.winner(transferMarkers)
    var uniqueTransfers: [UUID: PrivateTransferMarker] = [:]
    for marker in transferMarkers { uniqueTransfers[marker.transferID] = marker }
    let exportedEvents = retained.map {
      PersonalExportEvent(
        event: $0, includedInSummary: snapshot.includedEventIDs.contains($0.eventID),
        excludedSource: !PrivateTransferPolicy.includes($0, under: selected),
        publicUploadState: uploadStates[$0.eventID]
          ?? ($0.competitionEpochID == nil ? .notEnrolled : .unknown))
    }
    let sessions = snapshot.sessions.map {
      PersonalExportSession(
        deviceID: $0.deviceID, startMS: $0.startMS, endMS: $0.endMS,
        completeDurationMS: $0.durationMS, completeness: $0.completeness)
    }
    let days = snapshot.days.map {
      PersonalExportDay(
        date: $0.date, timezoneID: $0.timezoneID, folds: $0.folds, opens: $0.opens,
        closes: $0.closes, cycles: $0.cycles,
        completeDurationMS: $0.completeDurationMS, equivalentDegrees: $0.equivalentDegrees,
        equivalentMetres: $0.equivalentMetres)
    }
    return PersonalExportDocument(
      exportedAtMS: exportedAtMS, generation: generation, homeTimezone: homeTimezone,
      events: exportedEvents,
      interruptions: Array(Set(interruptions.filter { $0.generation == generation })).sorted {
        $0.interruptionID.uuidString < $1.interruptionID.uuidString
      },
      transferMarkers: uniqueTransfers.values.sorted {
        $0.transferID.uuidString < $1.transferID.uuidString
      }, sessions: sessions, dailySummaries: days)
  }

  public static func json(_ document: PersonalExportDocument) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    return try encoder.encode(document)
  }

  /// RFC4180 cells, including quoted newlines and apostrophe neutralization of formula-leading strings.
  public static func csvCell(_ value: String) -> String {
    let first = value.drop(while: { $0.isWhitespace }).first
    let protected =
      (first.map { "=+-@".contains($0) } ?? false) || value.first == "\t" || value.first == "\r"
        || value.first == "\n"
      ? "'" + value : value
    return "\"" + protected.replacingOccurrences(of: "\"", with: "\"\"") + "\""
  }

  public static func csvFiles(_ document: PersonalExportDocument) -> [PersonalExportFile] {
    func file(_ name: String, _ header: [String], _ rows: [[String]]) -> PersonalExportFile {
      let text =
        ([header] + rows).map { $0.map(csvCell).joined(separator: ",") }.joined(separator: "\r\n")
        + "\r\n"
      return PersonalExportFile(name: name, data: Data(text.utf8))
    }
    let events = file(
      "events.csv",
      [
        "event_id", "device_id", "sequence", "generation_revision", "generation_id",
        "observed_at_ms", "timezone_id", "transition", "is_test", "included_in_summary",
        "public_upload_state",
      ],
      document.events.map {
        let e = $0.event
        return [
          e.eventID.uuidString.lowercased(), e.deviceID.uuidString.lowercased(), String(e.sequence),
          String(e.generation.revision), e.generation.resetID.uuidString.lowercased(),
          String(e.observedAtMS), e.timezoneID, e.transition.rawValue, String(e.isTest),
          String($0.includedInSummary), $0.publicUploadState.rawValue,
        ]
      })
    let sessions = file(
      "sessions.csv", ["device_id", "start_ms", "end_ms", "complete_duration_ms", "completeness"],
      document.sessions.map {
        [
          $0.deviceID.uuidString.lowercased(), String($0.startMS), $0.endMS.map(String.init) ?? "",
          $0.completeDurationMS.map(String.init) ?? "", $0.completeness.rawValue,
        ]
      })
    let summaries = file(
      "daily-summaries.csv",
      [
        "date", "timezone_id", "folds", "opens", "closes", "cycles", "complete_duration_ms",
        "equivalent_degrees", "equivalent_metres",
      ],
      document.dailySummaries.map {
        [
          $0.date, $0.timezoneID, String($0.folds), String($0.opens), String($0.closes),
          String($0.cycles), String($0.completeDurationMS), String($0.equivalentDegrees),
          String($0.equivalentMetres),
        ]
      })
    let readme = """
      Folding export schema 1; reducer \(TrackingReducer.version).
      Home timezone: \(document.homeTimezone). Timestamps are integer UTC milliseconds.
      Equivalent travel formula v1: 180 degrees and pi * 0.1 metres per fold; not measured motion.
      Finalized duration includes complete/candidate sessions; running/incomplete duration is blank.
      CSV is UTF-8/RFC4180. Formula-leading strings are prefixed with an apostrophe; JSON preserves raw values.
      Test and excluded-source events are retained but excluded from summaries. A repeated-state observation may be eligible yet add no fold.
      """
    return [
      events, sessions, summaries, PersonalExportFile(name: "README.txt", data: Data(readme.utf8)),
    ]
  }
}
