import FoldingDomain
import Foundation

/// One anonymous usage event, encoded exactly as the `/v1/analytics/batches` wire event.
public struct UsageAnalyticsEvent: Codable, Equatable, Sendable {
  public let eventID: String
  public let kind: String
  public let atMS: Int64
  public let timezoneID: String
  public let backfill: Bool
  public let detail: String?
  public let refs: [String]

  enum CodingKeys: String, CodingKey {
    case eventID = "event_id"
    case kind
    case atMS = "at_ms"
    case timezoneID = "timezone_id"
    case backfill, detail,
      refs
  }

  // Encode `detail: null` explicitly; the wire contract names the key on every event.
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(eventID, forKey: .eventID)
    try values.encode(kind, forKey: .kind)
    try values.encode(atMS, forKey: .atMS)
    try values.encode(timezoneID, forKey: .timezoneID)
    try values.encode(backfill, forKey: .backfill)
    try values.encode(detail, forKey: .detail)
    try values.encode(refs, forKey: .refs)
  }

  init(
    eventID: UUID, kind: String, atMS: Int64, timezoneID: String, backfill: Bool = false,
    detail: String? = nil, refs: [UUID] = []
  ) {
    self.eventID = eventID.canonical
    self.kind = kind
    self.atMS = atMS
    self.timezoneID = timezoneID
    self.backfill = backfill
    self.detail = detail
    self.refs = refs.map(\.canonical)
  }

  /// Wire-safe detail: lowercase, `[a-z0-9_.]`, 1...64 characters.
  public static func isValidDetail(_ value: String) -> Bool {
    (1...64).contains(value.utf8.count)
      && value.utf8.allSatisfy {
        (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 46
      }
  }

  /// Folds arbitrary text (an error domain, a tab name) into a valid detail.
  public static func detail(_ raw: String) -> String {
    let mapped = String(
      raw.lowercased().unicodeScalars.map { scalar -> Character in
        let value = scalar.value
        return (97...122).contains(value) || (48...57).contains(value) || value == 95 || value == 46
          ? Character(scalar) : "_"
      }
    ).prefix(64)
    return mapped.isEmpty ? "unknown" : String(mapped)
  }
}

public struct UsageAnalyticsBatch: Equatable, Sendable {
  public let throughSeq: Int64
  public let events: [UsageAnalyticsEvent]
}

/// What the uploader does with a batch after the server answers.
public enum UsageAnalyticsUploadOutcome: Equatable, Sendable {
  case acknowledge
  case drop
  case retry(afterSeconds: Int)

  /// `status == nil` is a transport failure. `failures` counts consecutive retryable failures,
  /// including this one; the delay doubles from 30s and is capped at an hour.
  public static func decide(status: Int?, retryAfterSeconds: Int?, failures: Int) -> Self {
    if let status, (200..<300).contains(status) { return .acknowledge }
    if status == 400 || status == 413 { return .drop }
    let exponential = 30 << min(max(failures - 1, 0), 7)
    return .retry(afterSeconds: min(3600, max(exponential, retryAfterSeconds ?? 0)))
  }
}

extension TrackingStore {
  static let analyticsBackfilledKey = "analytics_backfilled"

  /// App-usage events. Fold history is queued by the journal itself.
  public func enqueueAnalytics(
    kind: String, detail: String? = nil, atMS: Int64, timezoneID: String
  ) throws {
    try validateTime(atMS)
    guard UsageAnalyticsEvent.isValidDetail(kind),
      detail.map(UsageAnalyticsEvent.isValidDetail) ?? true
    else { throw StoreError.invalidInput }
    try journalTransaction {
      try enqueueAnalyticsInTransaction(
        UsageAnalyticsEvent(
          eventID: UUID(), kind: kind, atMS: atMS, timezoneID: timezoneID, detail: detail))
    }
  }

  /// The oldest queued events. The first call after install or purge queues every retained
  /// own-device fold once, so history recorded before sharing started is reported as backfill.
  public func nextAnalyticsBatch(limit: Int = 256) throws -> UsageAnalyticsBatch? {
    guard (1...256).contains(limit) else { throw StoreError.invalidInput }
    return try journalTransaction {
      if try database.rows(
        "SELECT value FROM settings WHERE key=?", [.text(Self.analyticsBackfilledKey)]
      ).isEmpty {
        for event in try events() where event.deviceID == deviceID && !event.isTest {
          try enqueueAnalyticsInTransaction(Self.analyticsEvent(event, backfill: true))
        }
        try database.execute(
          "INSERT INTO settings(key,value) VALUES (?,'1')", [.text(Self.analyticsBackfilledKey)])
      }
      let rows = try database.rows(
        "SELECT seq,payload_json FROM analytics_queue ORDER BY seq LIMIT ?",
        [.integer(Int64(limit))])
      guard let last = rows.last, let seq = Int64(last["seq"]!) else { return nil }
      return UsageAnalyticsBatch(
        throughSeq: seq, events: try rows.map { try decode($0["payload_json"]!) })
    }
  }

  public func acknowledgeAnalytics(throughSeq: Int64) throws {
    try journalTransaction {
      try database.execute("DELETE FROM analytics_queue WHERE seq<=?", [.integer(throughSeq)])
    }
  }

  /// Sharing is off: forget queued events and re-backfill if sharing is turned on again.
  public func purgeAnalytics() throws {
    try journalTransaction {
      try database.execute("DELETE FROM analytics_queue")
      try database.execute(
        "DELETE FROM settings WHERE key=?", [.text(Self.analyticsBackfilledKey)])
    }
  }

  func enqueueAnalyticsInTransaction(_ event: UsageAnalyticsEvent) throws {
    try database.execute(
      "INSERT OR IGNORE INTO analytics_queue(event_id,payload_json,created_at_ms) VALUES (?,?,?)",
      [
        .text(event.eventID), .text(try encode(event)),
        .integer(Int64(Date().timeIntervalSince1970 * 1000)),
      ])
  }

  static func analyticsEvent(_ event: TrackingEvent, backfill: Bool = false) -> UsageAnalyticsEvent
  {
    UsageAnalyticsEvent(
      eventID: event.eventID, kind: event.transition == .open ? "fold_open" : "fold_close",
      atMS: event.observedAtMS, timezoneID: event.timezoneID, backfill: backfill)
  }
}
