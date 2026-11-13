import FoldingDomain
import Foundation

/// Discardable per-partition cache. One connection per owning actor/task; never shared concurrently.
final class PersonalDerivedCache {
  private let db: SQLiteConnection
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  init(directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: directory.path)
    #endif
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var excluded = directory
    try excluded.setResourceValues(values)
    db = try SQLiteConnection(url: directory.appendingPathComponent("derived-v1.sqlite"))
    try db.transaction {
      try db.execute(
        "CREATE TABLE IF NOT EXISTS heads (key TEXT PRIMARY KEY, revision INTEGER NOT NULL, epoch INTEGER NOT NULL, payload TEXT NOT NULL)"
      )
      try db.execute(
        "CREATE TABLE IF NOT EXISTS sources (key TEXT NOT NULL, device TEXT NOT NULL, ordinal INTEGER NOT NULL, checkpoint TEXT NOT NULL, PRIMARY KEY(key,device))"
      )
      try db.execute(
        "CREATE TABLE IF NOT EXISTS sessions (key TEXT NOT NULL,device TEXT NOT NULL,ordinal INTEGER NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER,state TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(key,device,ordinal))"
      )
      try db.execute("CREATE INDEX IF NOT EXISTS session_running ON sessions(key,state)")
      try db.execute(
        "CREATE INDEX IF NOT EXISTS session_page ON sessions(key,start_ms DESC,device DESC,ordinal DESC)"
      )
      try db.execute(
        "CREATE TABLE IF NOT EXISTS days (key TEXT NOT NULL,start_ms INTEGER NOT NULL,payload TEXT NOT NULL,duration_ms INTEGER NOT NULL,PRIMARY KEY(key,start_ms))"
      )
      try db.execute(
        "CREATE TABLE IF NOT EXISTS counted (key TEXT NOT NULL,event_id TEXT NOT NULL,observed_ms INTEGER NOT NULL,PRIMARY KEY(key,event_id))"
      )
      try db.execute(
        "CREATE TABLE IF NOT EXISTS deleted_events (key TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(key,event_id))"
      )
      try db.execute(
        "CREATE TABLE IF NOT EXISTS deleted_sessions (key TEXT NOT NULL,device TEXT NOT NULL,start_ms INTEGER NOT NULL,PRIMARY KEY(key,device,start_ms))"
      )
      try db.execute("CREATE INDEX IF NOT EXISTS counted_time ON counted(key,observed_ms)")
    }
  }
  private func key(_ timezone: String) -> String { "3:\(TrackingReducer.version):\(timezone)" }
  private func encode<T: Encodable>(_ value: T) throws -> String {
    String(decoding: try encoder.encode(value), as: UTF8.self)
  }
  private func decode<T: Decodable>(_ text: String) throws -> T {
    try decoder.decode(T.self, from: Data(text.utf8))
  }
  func header(timezone: String) throws -> DerivedHeader? {
    try db.rows("SELECT payload FROM heads WHERE key=?", [.text(key(timezone))]).first.map {
      try decode($0["payload"]!)
    }
  }
  private func saveHeader(_ header: DerivedHeader) throws {
    try db.execute(
      "INSERT INTO heads VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,epoch=excluded.epoch,payload=excluded.payload",
      [
        .text(key(header.homeTimezone)), .integer(header.revision), .integer(header.rebuildEpoch),
        .text(try encode(header)),
      ])
  }
  private func saveSession(_ session: TrackingSession, ordinal: Int64, key: String) throws {
    try db.execute(
      "INSERT INTO sessions VALUES (?,?,?,?,?,?,?)",
      [
        .text(key), .text(session.deviceID.uuidString.lowercased()), .integer(ordinal),
        .integer(session.startMS), session.endMS.map(SQLiteConnection.Value.integer) ?? .null,
        .text(session.completeness.rawValue), .text(try encode(session)),
      ])
  }
  private func isDeleted(_ session: TrackingSession, key: String) throws -> Bool {
    if let openingID = session.openingEventID {
      return try !db.rows(
        "SELECT event_id FROM deleted_events WHERE key=? AND event_id=?",
        [.text(key), .text(openingID.uuidString.lowercased())]
      ).isEmpty
    }
    return try !db.rows(
      "SELECT start_ms FROM deleted_sessions WHERE key=? AND device=? AND start_ms=?",
      [.text(key), .text(session.deviceID.uuidString.lowercased()), .integer(session.startMS)]
    ).isEmpty
  }
  private func saveSource(_ checkpoint: TrackingCheckpoint, ordinal: Int64, key: String) throws {
    try db.execute(
      "INSERT INTO sources VALUES (?,?,?,?) ON CONFLICT(key,device) DO UPDATE SET ordinal=excluded.ordinal,checkpoint=excluded.checkpoint",
      [
        .text(key), .text(checkpoint.deviceID.uuidString.lowercased()), .integer(ordinal),
        .text(try encode(checkpoint)),
      ])
  }
  private func saveDay(_ day: PersonalDailySummary, key: String) throws {
    try db.execute(
      "INSERT INTO days VALUES (?,?,?,?) ON CONFLICT(key,start_ms) DO UPDATE SET payload=excluded.payload,duration_ms=excluded.duration_ms",
      [.text(key), .integer(day.startMS), .text(try encode(day)), .integer(day.completeDurationMS)])
  }
  private func saveCounted(_ event: TrackingEvent, key: String) throws {
    try db.execute(
      "INSERT INTO counted VALUES (?,?,?)",
      [.text(key), .text(event.eventID.uuidString.lowercased()), .integer(event.observedAtMS)])
  }
  func rebuild(_ input: DerivedInput, timezone: String) throws {
    let projection = try PersonalAnalytics.snapshot(
      events: input.events, interruptions: input.interruptions,
      generation: input.generation, homeTimezone: timezone, asOfMS: 0,
      range: PersonalDateRange(startMS: 0, endMS: 1), transferMarkers: input.transfers,
      deletions: input.deletions)
    let counted = input.events.filter { projection.countedEventIDs.contains($0.eventID) }
    let days = try PersonalDayAggregation.days(
      countedEvents: counted, sessions: projection.sessions, homeTimezone: timezone)
    let selection = try PrivateTransferPolicy.winner(input.transfers)
    let included = input.events.filter { PrivateTransferPolicy.includes($0, under: selection) }
    let deletedIDs = Set(input.deletions.flatMap(\.eventIDs))
    let eligible = included.filter { !$0.isTest && !deletedIDs.contains($0.eventID) }
    let header = DerivedHeader(
      journalID: input.revision.journalID, revision: input.revision.revision,
      rebuildEpoch: input.revision.rebuildEpoch,
      generation: input.generation, homeTimezone: timezone,
      totals: PersonalTotals(projection.lifetime),
      selection: selection, observedDevices: projection.observedDeviceIDs,
      firstEventMS: eligible.map(\.observedAtMS).min(),
      lastEventMS: eligible.map(\.observedAtMS).max())
    let cacheKey = key(timezone)
    let sessionsBySource = Dictionary(grouping: projection.sessions, by: \.deviceID)
    try Task.checkCancellation()
    try db.transaction {
      if let existing = try self.header(timezone: timezone), existing.journalID == header.journalID,
        existing.revision > header.revision
      {
        return
      }
      for table in ["sources", "sessions", "days", "counted", "deleted_events", "deleted_sessions"]
      {
        try db.execute("DELETE FROM \(table) WHERE key=?", [.text(cacheKey)])
      }
      for marker in input.deletions where marker.target.generation == input.generation {
        try db.execute(
          "INSERT OR IGNORE INTO deleted_sessions VALUES (?,?,?)",
          [
            .text(cacheKey), .text(marker.target.deviceID.uuidString.lowercased()),
            .integer(marker.target.startMS),
          ])
        for eventID in marker.eventIDs {
          try db.execute(
            "INSERT OR IGNORE INTO deleted_events VALUES (?,?)",
            [.text(cacheKey), .text(eventID.uuidString.lowercased())])
        }
      }
      for (source, events) in Dictionary(grouping: included, by: \.deviceID) {
        var checkpoint = TrackingCheckpoint(deviceID: source, generation: input.generation)
        let markers = input.interruptions.filter {
          $0.deviceID == source
            && (selection == nil || source == selection?.activeDeviceID
              || $0.afterSequence <= selection!.sourceWatermarks[source, default: 0])
        }.map(\.afterSequence).sorted()
        var position = 0
        for event in events.sorted(by: { $0.sequence < $1.sequence }) {
          while position < markers.count && markers[position] < event.sequence {
            _ = checkpoint.interrupt()
            position += 1
          }
          _ = try checkpoint.append(event)
        }
        if position < markers.count || (selection != nil && source != selection?.activeDeviceID) {
          _ = checkpoint.interrupt()
        }
        let sourceSessions = sessionsBySource[source, default: []]
        for (index, session) in sourceSessions.enumerated() {
          try saveSession(session, ordinal: Int64(index), key: cacheKey)
        }
        try saveSource(
          checkpoint, ordinal: Int64(sourceSessions.filter { $0.completeness != .running }.count),
          key: cacheKey)
      }
      for day in days { try saveDay(day, key: cacheKey) }
      for event in counted { try saveCounted(event, key: cacheKey) }
      try saveHeader(header)
    }
  }
  /// Returns false when another process changed this cache or conservative full replay is required.
  func append(events: [TrackingEvent], from expected: DerivedHeader, to revision: DerivedRevision)
    throws -> Bool
  {
    let cacheKey = key(expected.homeTimezone)
    return try db.transaction {
      guard var header = try header(timezone: expected.homeTimezone),
        header.journalID == expected.journalID, header.revision == expected.revision,
        header.rebuildEpoch == revision.rebuildEpoch
      else { return false }
      guard
        events.allSatisfy({
          header.selection == nil || $0.deviceID == header.selection?.activeDeviceID
        })
      else { return false }
      for event in events.sorted(by: {
        ($0.deviceID.uuidString, $0.sequence) < ($1.deviceID.uuidString, $1.sequence)
      }) {
        let device = event.deviceID.uuidString.lowercased()
        let row = try db.rows(
          "SELECT ordinal,checkpoint FROM sources WHERE key=? AND device=?",
          [.text(cacheKey), .text(device)]
        ).first
        var checkpoint: TrackingCheckpoint =
          try row.map { try decode($0["checkpoint"]!) }
          ?? TrackingCheckpoint(deviceID: event.deviceID, generation: header.generation)
        var ordinal = row?["ordinal"].flatMap(Int64.init) ?? 0
        let rawDelta = try checkpoint.append(event)
        let deletedEvent = try !db.rows(
          "SELECT event_id FROM deleted_events WHERE key=? AND event_id=?",
          [.text(cacheKey), .text(event.eventID.uuidString.lowercased())]
        ).isEmpty
        let deletedSession =
          try rawDelta.finishedSession.map { try isDeleted($0, key: cacheKey) } ?? false
        let delta = rawDelta.suppressingDeleted(event: deletedEvent, session: deletedSession)
        try header.totals.apply(delta)
        try db.execute(
          "DELETE FROM sessions WHERE key=? AND device=? AND state='running'",
          [.text(cacheKey), .text(device)])
        if let finished = delta.finishedSession {
          try saveSession(finished, ordinal: ordinal, key: cacheKey)
          ordinal += 1
        }
        if let running = checkpoint.runningSession, try !isDeleted(running, key: cacheKey) {
          try saveSession(running, ordinal: ordinal, key: cacheKey)
        }
        try saveSource(checkpoint, ordinal: ordinal, key: cacheKey)
        if delta.counted { try saveCounted(event, key: cacheKey) }
        let changes = try PersonalDayAggregation.days(
          countedEvents: delta.counted ? [event] : [],
          sessions: delta.finishedSession.map { [$0] } ?? [], homeTimezone: header.homeTimezone)
        for day in changes {
          let old: PersonalDailySummary? = try db.rows(
            "SELECT payload FROM days WHERE key=? AND start_ms=?",
            [.text(cacheKey), .integer(day.startMS)]
          ).first.map { try decode($0["payload"]!) }
          try saveDay(
            try old.map { try PersonalDayAggregation.merging($0, day) } ?? day, key: cacheKey)
        }
        if !event.isTest {
          header.observedDevices.insert(event.deviceID)
          header.firstEventMS = min(header.firstEventMS ?? event.observedAtMS, event.observedAtMS)
          header.lastEventMS = max(header.lastEventMS ?? event.observedAtMS, event.observedAtMS)
        }
      }
      header.revision = revision.revision
      try saveHeader(header)
      return true
    }
  }
  func compact(timezone: String, revision: DerivedRevision, asOfMS: Int64, range: PersonalDateRange)
    throws -> CompactPersonalSnapshot?
  {
    guard range.startMS < range.endMS, range.endMS - range.startMS <= 370 * 86_400_000,
      (0...TrackingReducer.maximumInteger).contains(asOfMS)
    else { throw PersonalReadError.invalidRange }
    return try db.transaction(write: false) {
      guard let header = try header(timezone: timezone), header.journalID == revision.journalID,
        header.revision == revision.revision
      else {
        return nil
      }
      let cacheKey = key(timezone)
      let running: [TrackingSession] = try db.rows(
        "SELECT payload FROM sessions WHERE key=? AND state='running' ORDER BY device,ordinal LIMIT 1001",
        [.text(cacheKey)]
      ).map { try decode($0["payload"]!) }
      guard running.count <= 1000 else { throw AnalyticsError.resultTooLarge }
      let overlays = try PersonalDayAggregation.days(
        countedEvents: [], sessions: running,
        homeTimezone: timezone, range: range, asOfMS: asOfMS)
      guard overlays.count <= 366, overlays.first?.startMS == range.startMS,
        overlays.last?.endMS == range.endMS
      else { throw PersonalReadError.invalidRange }
      let saved: [PersonalDailySummary] = try db.rows(
        "SELECT payload FROM days WHERE key=? AND start_ms>=? AND start_ms<? ORDER BY start_ms LIMIT 367",
        [
          .text(cacheKey), .integer(overlays.first?.startMS ?? range.startMS),
          .integer(range.endMS),
        ]
      ).map { try decode($0["payload"]!) }
      let byDay = Dictionary(uniqueKeysWithValues: saved.map { ($0.startMS, $0) })
      let days = try overlays.map { overlay in
        try byDay[overlay.startMS].map { try PersonalDayAggregation.merging($0, overlay) }
          ?? overlay
      }
      return CompactPersonalSnapshot(
        version: header.version, asOfMS: asOfMS, range: range,
        lifetime: header.totals, days: days, runningSessions: running,
        selectedDeviceID: header.selection?.activeDeviceID,
        observedDeviceCount: header.observedDevices.count)
    }
  }
  func sessions(
    timezone: String, revision: DerivedRevision, range: PersonalDateRange,
    cursor: PersonalSessionCursor?, limit: Int
  ) throws -> PersonalSessionPage? {
    guard (1...200).contains(limit), range.startMS < range.endMS else {
      throw PersonalReadError.invalidRange
    }
    return try db.transaction(write: false) {
      guard let header = try header(timezone: timezone), header.journalID == revision.journalID,
        header.revision == revision.revision
      else {
        return nil
      }
      if let cursor {
        guard cursor.version == header.version, cursor.range == PersonalDateRangeWire(range) else {
          throw PersonalReadError.invalidCursor
        }
      }
      let pageClause = cursor == nil ? "" : " AND (start_ms,device,ordinal)<(?,?,?)"
      var values: [SQLiteConnection.Value] = [
        .text(key(timezone)), .integer(range.endMS), .integer(range.startMS),
      ]
      if let cursor {
        values += [
          .integer(cursor.afterStartMS), .text(cursor.afterDeviceID), .integer(cursor.afterOrdinal),
        ]
      }
      values.append(.integer(Int64(limit + 1)))
      let rows = try db.rows(
        "SELECT device,ordinal,start_ms,payload FROM sessions WHERE key=? AND start_ms<? AND (end_ms IS NULL OR end_ms>?)\(pageClause) ORDER BY start_ms DESC,device DESC,ordinal DESC LIMIT ?",
        values)
      let page = Array(rows.prefix(limit))
      let sessions: [TrackingSession] = try page.map { try decode($0["payload"]!) }
      let next =
        rows.count > limit
        ? page.last.map {
          PersonalSessionCursor(
            version: header.version, range: PersonalDateRangeWire(range),
            afterStartMS: Int64($0["start_ms"]!)!, afterDeviceID: $0["device"]!,
            afterOrdinal: Int64($0["ordinal"]!)!)
        } : nil
      return PersonalSessionPage(version: header.version, sessions: sessions, nextCursor: next)
    }
  }
  func history(
    timezone: String, revision: DerivedRevision, asOfMS: Int64, period: PersonalHistoryPeriod,
    offset: Int, cursor: PersonalHistoryCursor?, limit: Int
  ) throws -> CompactHistoryPage? {
    let binOffset = cursor?.nextBinOffset ?? 0
    guard (1...240).contains(limit), (0...100000).contains(binOffset) else {
      throw PersonalReadError.invalidRange
    }
    return try db.transaction(write: false) {
      guard let header = try header(timezone: timezone), header.journalID == revision.journalID,
        header.revision == revision.revision
      else {
        return nil
      }
      if let cursor {
        guard cursor.version == header.version, cursor.period == period, cursor.offset == offset
        else { throw PersonalReadError.invalidCursor }
      }
      let frozenNow = cursor?.asOfMS ?? asOfMS
      let layout = try PersonalHistory.layout(
        homeTimezone: timezone, asOfMS: frozenNow, period: period,
        offset: offset, firstEventMS: header.firstEventMS, lastEventMS: header.lastEventMS,
        binOffset: binOffset, binLimit: limit)
      if let cursor, cursor.range != PersonalDateRangeWire(layout.range) {
        throw PersonalReadError.invalidCursor
      }
      let cacheKey = key(timezone)
      let bins = try layout.bins.map { bin in
        let count =
          Int(
            try db.rows(
              "SELECT COUNT(*) AS n FROM counted WHERE key=? AND observed_ms>=? AND observed_ms<?",
              [.text(cacheKey), .integer(bin.startMS), .integer(bin.endMS)]
            ).first?["n"] ?? "0") ?? 0
        return PersonalHistoryBin(startMS: bin.startMS, endMS: bin.endMS, folds: count)
      }
      let folds =
        Int(
          try db.rows(
            "SELECT COUNT(*) AS n FROM counted WHERE key=? AND observed_ms>=? AND observed_ms<?",
            [.text(cacheKey), .integer(layout.range.startMS), .integer(layout.range.endMS)]
          ).first?["n"] ?? "0") ?? 0
      let duration =
        Int64(
          try db.rows(
            "SELECT SUM(duration_ms) AS duration FROM days WHERE key=? AND start_ms>=? AND start_ms<?",
            [.text(cacheKey), .integer(layout.range.startMS), .integer(layout.range.endMS)]
          ).first?["duration"] ?? "0") ?? 0
      let more = bins.last.map { $0.endMS < layout.range.endMS } ?? false
      return CompactHistoryPage(
        version: header.version, range: layout.range, bins: bins,
        nextBinOffset: more ? binOffset + bins.count : nil,
        nextCursor: more
          ? PersonalHistoryCursor(
            version: header.version, range: PersonalDateRangeWire(layout.range), period: period,
            offset: offset, asOfMS: frozenNow, nextBinOffset: binOffset + bins.count) : nil,
        canGoNext: offset < 0,
        folds: folds, completeDurationMS: duration)
    }
  }
}
