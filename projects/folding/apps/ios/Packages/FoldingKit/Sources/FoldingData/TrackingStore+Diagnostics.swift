import FoldingDomain
import Foundation

extension TrackingStore {
  /// Keeps a bounded local history without invalidating personal-statistics caches.
  public func appendDiagnostic(_ entry: TrackingDiagnosticEntry) throws {
    try validateTime(entry.atMS)
    try journalTransaction {
      let raw = try database.rows("SELECT value FROM settings WHERE key='tracking_diagnostics_v1'")
        .first?["value"]
      var entries = TrackingDiagnosticEntry.stored(raw)
      entries.append(entry)
      entries = Array(entries.suffix(128))
      try database.execute(
        "INSERT INTO settings(key,value) VALUES('tracking_diagnostics_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(try encode(entries))])
    }
  }

  public func clearDiagnostics() throws {
    try journalTransaction {
      try database.execute("DELETE FROM settings WHERE key='tracking_diagnostics_v1'")
    }
  }

  public func diagnosticReport(nowMS: Int64) throws -> String {
    try diagnosticSnapshot(nowMS: nowMS).text
  }

  public func diagnosticSnapshot(nowMS: Int64) throws -> TrackingDiagnosticSnapshot {
    let queue = try competitionUploadQueueState(nowMS: nowMS)
    return try journalTransaction(write: false) {
      var fields = [
        "queue": queue.rawValue, "generation_revision": String(try generation().revision),
      ]
      for (name, sql) in [
        ("schema_version", "PRAGMA user_version"),
        ("sqlite_version", "SELECT sqlite_version() AS value"),
        (
          "pending_uploads",
          "SELECT COUNT(*) AS value FROM work_outbox WHERE kind IN ('competition_event','competition_history','competition_reset') AND state='pending'"
        ),
        (
          "pending_captures",
          "SELECT COUNT(*) AS value FROM captured_observations WHERE state='pending'"
        ),
        (
          "quarantined_captures",
          "SELECT COUNT(*) AS value FROM captured_observations WHERE state='quarantined'"
        ),
        (
          "pending_mirror",
          "SELECT COUNT(*) AS value FROM work_outbox WHERE kind LIKE 'mirror_%' AND state IN ('pending','leased')"
        ),
      ] {
        let row = try database.rows(sql).first
        fields[name] = row?["value"] ?? row?["user_version"] ?? "unknown"
      }
      if let raw = try database.rows(
        "SELECT value FROM settings WHERE key='competition_upload_not_before'"
      ).first?["value"],
        let deadline = Int64(raw)
      {
        fields["next_batch_seconds"] = String(deadline > nowMS ? (deadline - nowMS) / 1000 : 0)
      }
      if let raw = try database.rows(
        "SELECT value FROM settings WHERE key='competition_upload_suspended'"
      ).first?["value"] {
        fields["pause_reason"] =
          TrackingDiagnosticEntry.Reason(rawValue: raw)?.rawValue ?? "service"
      }
      if let raw = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
        .first?["value"],
        let work = try? decode(raw) as CompetitionUpload
      {
        fields["leased_seconds"] = String(
          work.leaseUntilMS > nowMS ? (work.leaseUntilMS - nowMS) / 1000 : 0)
        fields["retry_seconds"] = String(
          work.nextAttemptMS > nowMS ? (work.nextAttemptMS - nowMS) / 1000 : 0)
        fields["batch_events"] = String(work.eventIDs.count)
        fields["attempts"] = String(work.attempts ?? 0)
        if let reason = work.retryReason { fields["retry_reason"] = reason.rawValue }
      }
      let raw = try database.rows("SELECT value FROM settings WHERE key='tracking_diagnostics_v1'")
        .first?["value"]
      let entries = TrackingDiagnosticEntry.stored(raw)
      return TrackingDiagnosticSnapshot(capturedAtMS: nowMS, context: fields, events: entries)
    }
  }
}
