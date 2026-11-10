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
    case signingBusy = "signing_busy"
    case attestationKeyGenerationStarted = "attestation_key_generation_started"
    case attestationKeyGenerated = "attestation_key_generated"
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
  public func json() throws -> String {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(self), as: UTF8.self)
  }
}
