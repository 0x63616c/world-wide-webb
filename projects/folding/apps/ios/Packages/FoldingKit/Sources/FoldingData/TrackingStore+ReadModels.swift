import FoldingDomain
import Foundation

extension TrackingStore {
  /// Calendar-aligned day ranges, at most 366 days. Running time is projected at the supplied clock.
  public func compactAnalytics(homeTimezone: String, asOfMS: Int64, range: PersonalDateRange)
    async throws -> CompactPersonalSnapshot
  {
    for _ in 0..<3 {
      try await refreshDerivedCache(homeTimezone: homeTimezone)
      if let result = try journalTransaction(
        write: false,
        {
          try cache().compact(
            timezone: homeTimezone, revision: derivedRevision(), asOfMS: asOfMS, range: range)
        })
      {
        return result
      }
    }
    throw PersonalReadError.changedSnapshot
  }

  public func sessionPage(
    homeTimezone: String, range: PersonalDateRange,
    cursor: PersonalSessionCursor? = nil, limit: Int = 50
  ) async throws -> PersonalSessionPage {
    for _ in 0..<3 {
      try await refreshDerivedCache(homeTimezone: homeTimezone)
      if let result = try journalTransaction(
        write: false,
        {
          try cache().sessions(
            timezone: homeTimezone, revision: derivedRevision(), range: range, cursor: cursor,
            limit: limit)
        })
      {
        return result
      }
    }
    throw PersonalReadError.changedSnapshot
  }

  public func historyPage(
    homeTimezone: String, asOfMS: Int64, period: PersonalHistoryPeriod,
    offset: Int, cursor: PersonalHistoryCursor? = nil, limit: Int = 120
  ) async throws -> CompactHistoryPage {
    for _ in 0..<3 {
      try await refreshDerivedCache(homeTimezone: homeTimezone)
      if let result = try journalTransaction(
        write: false,
        {
          try cache().history(
            timezone: homeTimezone, revision: derivedRevision(), asOfMS: asOfMS,
            period: period, offset: offset, cursor: cursor, limit: limit)
        })
      {
        return result
      }
    }
    throw PersonalReadError.changedSnapshot
  }

  // Test seam for deterministic reset/account/rebuild races; no alternate production data path.
  func setDerivedBuildObserver(_ observer: (@Sendable (Bool) async -> Void)?) {
    derivedBuildObserver = observer
  }

  private func cache() throws -> PersonalDerivedCache {
    if let derivedCache { return derivedCache }
    let cache = try PersonalDerivedCache(directory: derivedCacheDirectory)
    derivedCache = cache
    return cache
  }

  func derivedRevision() throws -> DerivedRevision {
    guard
      let row = try database.rows("SELECT journal_id,revision,epoch FROM derived_state WHERE id=1")
        .first,
      let id = row["journal_id"].flatMap(UUID.init(uuidString:)),
      let revision = row["revision"].flatMap(Int64.init),
      let epoch = row["epoch"].flatMap(Int64.init)
    else { throw StoreError.invalidInput }
    return DerivedRevision(journalID: id, revision: revision, rebuildEpoch: epoch)
  }

  private func refreshDerivedCache(homeTimezone: String) async throws {
    enum Work: Sendable {
      case current
      case append(DerivedHeader, DerivedRevision, [TrackingEvent])
      case rebuild(DerivedInput)
    }
    let work: Work = try journalTransaction(write: false) {
      let revision = try derivedRevision()
      if let header = try cache().header(timezone: homeTimezone),
        header.journalID == revision.journalID
      {
        if header.revision == revision.revision { return .current }
        let gap = revision.revision - header.revision
        if header.rebuildEpoch == revision.rebuildEpoch, (1...2048).contains(gap) {
          let events: [TrackingEvent] = try database.rows(
            "SELECT e.payload_json FROM derived_changes c JOIN events e ON e.event_id=c.event_id WHERE c.revision>? AND c.revision<=? ORDER BY c.revision LIMIT 2048",
            [.integer(header.revision), .integer(revision.revision)]
          ).map { try decode($0["payload_json"]!) }
          if events.count == gap,
            events.allSatisfy({
              header.selection == nil || $0.deviceID == header.selection?.activeDeviceID
            })
          {
            return .append(header, revision, events)
          }
        }
      }
      return .rebuild(
        DerivedInput(
          revision: revision, generation: try generation(), events: try events(),
          interruptions: try interruptions(), transfers: try transferMarkersInTransaction(),
          deletions: try deletions()))
    }
    let directory = derivedCacheDirectory
    let observer = derivedBuildObserver
    switch work {
    case .current: return
    case .append(let header, let revision, let events):
      let task = Task.detached(priority: .userInitiated) {
        if let observer { await observer(false) }
        try Task.checkCancellation()
        _ = try PersonalDerivedCache(directory: directory).append(
          events: events, from: header, to: revision)
      }
      try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
    case .rebuild(let input):
      let task = Task.detached(priority: .userInitiated) {
        if let observer { await observer(true) }
        try Task.checkCancellation()
        try PersonalDerivedCache(directory: directory).rebuild(input, timezone: homeTimezone)
      }
      try await withTaskCancellationHandler {
        try await task.value
      } onCancel: {
        task.cancel()
      }
    }
  }

  public func summary() throws -> TrackingSummary {
    try journalTransaction(write: false) {
      try PersonalAnalytics.snapshot(
        events: events(), interruptions: interruptions(), generation: generation(),
        homeTimezone: "UTC", asOfMS: 0, range: PersonalDateRange(startMS: 0, endMS: 1),
        transferMarkers: transferMarkersInTransaction(), deletions: deletions()
      ).lifetime
    }
  }

  /// Snapshot under a read transaction, then perform calendar work without holding the database lock.
  /// This actor runs off MainActor; UI refreshes on committed changes rather than timer ticks.
  public func analytics(homeTimezone: String, asOfMS: Int64, range: PersonalDateRange) throws
    -> PersonalAnalyticsSnapshot
  {
    let input = try journalTransaction(write: false) {
      (
        try events(), try interruptions(), try generation(), try transferMarkersInTransaction(),
        try deletions()
      )
    }
    return try PersonalAnalytics.snapshot(
      events: input.0, interruptions: input.1, generation: input.2, homeTimezone: homeTimezone,
      asOfMS: asOfMS, range: range, transferMarkers: input.3, deletions: input.4)
  }

  public func history(
    homeTimezone: String, asOfMS: Int64, period: PersonalHistoryPeriod, offset: Int
  ) throws -> PersonalHistorySnapshot {
    let input = try journalTransaction(write: false) {
      (
        try events(), try interruptions(), try generation(), try transferMarkersInTransaction(),
        try deletions()
      )
    }
    return try PersonalHistory.snapshot(
      events: input.0, interruptions: input.1, generation: input.2, homeTimezone: homeTimezone,
      asOfMS: asOfMS, period: period, offset: offset, transferMarkers: input.3, deletions: input.4)
  }

  public func lastObservedAtMS() throws -> Int64? {
    try journalTransaction(write: false) {
      let row = try database.rows(
        "SELECT observed_at_ms FROM events WHERE device_id=? AND event_id NOT IN (SELECT entity_id FROM quarantines) ORDER BY sequence DESC LIMIT 1",
        [.text(deviceID.canonical)]
      ).first
      return row?["observed_at_ms"].flatMap(Int64.init)
    }
  }

  func captureExportSnapshot() throws -> TrackingExportSnapshot {
    try journalTransaction(write: false) {
      let excluded = Set(
        try database.rows("SELECT DISTINCT entity_id FROM quarantines").compactMap {
          $0["entity_id"].flatMap(UUID.init(uuidString:))
        })
      var uploads: [UUID: ExportUploadState] = [:]
      for row in try database.rows(
        "SELECT entity_id,state FROM work_outbox WHERE kind IN ('competition_event','competition_history')"
      ) {
        guard let raw = row["entity_id"], let id = UUID(uuidString: raw), let state = row["state"]
        else { throw StoreError.invalidInput }
        switch state {
        case "pending", "leased", "retry_wait": uploads[id] = .pending
        case "acknowledged": uploads[id] = .acknowledged
        case "quarantined", "permanently_rejected": uploads[id] = .rejected
        default: uploads[id] = .unknown
        }
      }
      return TrackingExportSnapshot(
        generation: try generation(), events: try events(includeQuarantined: true),
        interruptions: try interruptions(), transferMarkers: try transferMarkersInTransaction(),
        excludedEventIDs: excluded, uploadStates: uploads, deletions: try deletions())
    }
  }

  func validateExportGeneration(_ expected: ResetGeneration) throws {
    try journalTransaction(write: false) {
      guard try generation() == expected else { throw TrackingExportError.staleSnapshot }
    }
  }

  public func retainedEvents() throws -> [TrackingEvent] {
    try journalTransaction(write: false) { try events(includeQuarantined: true) }
  }

  public func privateHistoryHealth() throws -> PrivateHistoryHealth {
    try journalTransaction(write: false) {
      let count =
        Int(try database.rows("SELECT COUNT(*) AS n FROM rejected_reset_ids").first?["n"] ?? "0")
        ?? 0
      let rejected =
        Int64(
          try database.rows(
            "SELECT value FROM settings WHERE key='highest_rejected_reset_revision'"
          ).first?["value"] ?? "0") ?? 0
      let highest = try highestResetRevision()
      let current = try generation()
      return PrivateHistoryHealth(
        conflictingResetCount: count,
        highestKnownResetRevision: highest,
        requiresAttention: count > 0 && current.revision <= rejected,
        canResetHistory: highest < TrackingReducer.maximumInteger)
    }
  }

  public func journalRevisionToken() throws -> String {
    try journalTransaction(write: false) {
      let version = try derivedRevision()
      return "\(version.journalID):\(version.revision)"
    }
  }
}
