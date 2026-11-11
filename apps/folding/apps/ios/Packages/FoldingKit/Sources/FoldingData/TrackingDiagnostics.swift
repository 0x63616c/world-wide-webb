import Foundation

/// Local diagnostic metadata, separate from captured observations and never mirrored.
public struct TrackingDiagnosticEntry: Codable, Equatable, Sendable {
  public enum Event: String, Codable, Sendable {
    case captureSaved = "capture_saved"
    case processingStarted = "processing_started"
    case processingCompleted = "processing_completed"
    case processingFailed = "processing_failed"
    case syncStarted = "sync_started"
    case syncCompleted = "sync_completed"
    case syncFailed = "sync_failed"
    case uploadStarted = "upload_started"
    case uploadAccepted = "upload_accepted"
    case uploadDeferred = "upload_deferred"
    case uploadCancelled = "upload_cancelled"
    case uploadQueueFailed = "upload_queue_failed"
    case uploadRuntimeFailed = "upload_runtime_failed"
    case sessionRefreshStarted = "session_refresh_started"
    case sessionRefreshJoined = "session_refresh_joined"
    case sessionRefreshCompleted = "session_refresh_completed"
    case sessionRefreshFailed = "session_refresh_failed"
    case sessionAuthenticationRequired = "session_authentication_required"
    case sessionRefreshRecovered = "session_refresh_recovered"
    case signingBusy = "signing_busy"
    case attestationKeyGenerationStarted = "attestation_key_generation_started"
    case attestationKeyGenerated = "attestation_key_generated"
    case attestationProofExpired = "attestation_proof_expired"
    case attestationEnrollmentStarted = "attestation_enrollment_started"
    case attestationEnrollmentCompleted = "attestation_enrollment_completed"
    case attestationEnrollmentFailed = "attestation_enrollment_failed"
    case attestationAssertionStarted = "attestation_assertion_started"
    case attestationAssertionCompleted = "attestation_assertion_completed"
    case attestationAssertionFailed = "attestation_assertion_failed"
    case uploadRetryScheduled = "upload_retry_scheduled"
    case captureQuarantined = "capture_quarantined"
    case network
    case widgetSnapshotWritten = "widget_snapshot_written"
    case widgetFailed = "widget_failed"
    case notificationCheck = "notification_check"
    case notificationAuthorization = "notification_authorization"
    case notificationScheduled = "notification_scheduled"
    case notificationFailed = "notification_failed"
    case foreground, background, inactive
    case accountSuspended = "account_suspended"
    case accountResumed = "account_resumed"
    case connectionCheck = "connection_check"
  }
  public enum Reason: String, Codable, Sendable {
    case database, partition, decoding, cancelled, unauthorized, busy, unavailable
    case challengeExpired = "challenge_expired"
    case authenticationRequired = "authentication_required"
    case invalidResponse = "invalid_response"
    case unsupportedAttestation = "unsupported_attestation"
    case network, service, unknown
    case identityConflict = "identity_conflict"
    case invalidInput = "invalid_input"
    case generationStale = "generation_stale"
    case epochStale = "epoch_stale"
    case restricted
    case rateLimited = "rate_limited"
    case appUpdateRequired = "app_update_required"
    case malformedRequest = "malformed_request"
  }
  public enum Route: String, Codable, Sendable {
    case account, auth, attestation, events, history, reset, leaderboard, profile, avatars
    case authRefresh = "auth_refresh"
    case attestationChallenge = "attestation_challenge"
    case attestationEnrollment = "attestation_enrollment"
    case milestones, results, notifications, health, other
  }
  public let atMS: Int64
  public let event: Event
  public let reason: Reason?
  public let route: Route?
  public let status: Int?
  public let detail: Int?
  public let count: Int?
  public let durationMS: Int?
  public let attempt: Int?
  public let retryDelayMS: Int?
  public let requestID: UUID?

  public init(
    atMS: Int64, event: Event, reason: Reason? = nil, route: Route? = nil,
    status: Int? = nil, detail: Int? = nil, count: Int? = nil,
    durationMS: Int? = nil, attempt: Int? = nil, retryDelayMS: Int? = nil, requestID: UUID? = nil
  ) {
    self.atMS = atMS
    self.event = event
    self.reason = reason
    self.route = route
    self.status = status.flatMap { (100...599).contains($0) ? $0 : nil }
    self.detail = detail.map { max(-1_000_000, min($0, 1_000_000)) }
    self.count = count.map { max(0, min($0, 1_000_000)) }
    self.durationMS = durationMS.map { max(0, min($0, 86_400_000)) }
    self.attempt = attempt.map { max(0, min($0, 1_000_000)) }
    self.retryDelayMS = retryDelayMS.map { max(0, min($0, 604_800_000)) }
    self.requestID = requestID
  }

  public var line: String {
    let time = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(atMS) / 1000))
    var parts = [time, event.rawValue]
    if let route { parts.append("route=\(route.rawValue)") }
    if let reason { parts.append("reason=\(reason.rawValue)") }
    if let status { parts.append("http=\(status)") }
    if let detail { parts.append("detail=\(detail)") }
    if let count { parts.append("count=\(count)") }
    if let durationMS { parts.append("duration_ms=\(durationMS)") }
    if let attempt { parts.append("attempt=\(attempt)") }
    if let retryDelayMS { parts.append("retry_delay_ms=\(retryDelayMS)") }
    if let requestID { parts.append("request_id=\(requestID.uuidString.lowercased())") }
    return parts.joined(separator: " ")
  }
}

/// Versioned support export: typed events and named snapshot fields, without raw payloads.
public struct TrackingDiagnosticSnapshot: Codable, Sendable {
  public var formatVersion = 1
  public var capturedAtMS: Int64
  public var context: [String: String]
  public var events: [TrackingDiagnosticEntry]
  public init(
    capturedAtMS: Int64, context: [String: String] = [:], events: [TrackingDiagnosticEntry] = []
  ) {
    self.capturedAtMS = capturedAtMS
    self.context = context
    self.events = events
  }
  public var text: String {
    (["Folding diagnostics"] + context.keys.sorted().map { "\($0)=\(context[$0]!)" }
      + ["\nRecent activity (\(events.count))"] + events.map(\.line)).joined(separator: "\n")
  }
  public func json(timeZone: TimeZone = .current) throws -> String {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    // Keep stored event decoding compatible; enrich the support export with readable times.
    guard
      var object = try JSONSerialization.jsonObject(with: encoder.encode(self)) as? [String: Any]
    else {
      throw EncodingError.invalidValue(
        self, .init(codingPath: [], debugDescription: "Expected diagnostic object"))
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    func times(_ milliseconds: Int64) -> (String, String) {
      let date = Date(timeIntervalSince1970: Double(milliseconds) / 1000)
      formatter.timeZone = TimeZone(secondsFromGMT: 0)
      let utc = formatter.string(from: date)
      formatter.timeZone = timeZone
      return (utc, formatter.string(from: date))
    }
    let captured = times(capturedAtMS)
    object["captured_at_utc"] = captured.0
    object["captured_at_local"] = captured.1
    object["local_timezone"] = timeZone.identifier
    var rows = object["events"] as? [[String: Any]] ?? []
    for index in rows.indices {
      let timestamp = times(events[index].atMS)
      rows[index]["at_utc"] = timestamp.0
      rows[index]["at_local"] = timestamp.1
    }
    object["events"] = rows
    return String(
      decoding: try JSONSerialization.data(
        withJSONObject: object,
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
  }
}
