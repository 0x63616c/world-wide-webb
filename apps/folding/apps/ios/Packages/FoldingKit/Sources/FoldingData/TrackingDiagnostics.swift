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
  public let requestID: UUID?

  public init(
    atMS: Int64, event: Event, reason: Reason? = nil, route: Route? = nil,
    status: Int? = nil, detail: Int? = nil, count: Int? = nil,
    durationMS: Int? = nil, requestID: UUID? = nil
  ) {
    self.atMS = atMS
    self.event = event
    self.reason = reason
    self.route = route
    self.status = status.flatMap { (100...599).contains($0) ? $0 : nil }
    self.detail = detail.map { max(-1_000_000, min($0, 1_000_000)) }
    self.count = count.map { max(0, min($0, 1_000_000)) }
    self.durationMS = durationMS.map { max(0, min($0, 86_400_000)) }
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
    if let requestID { parts.append("request_id=\(requestID.uuidString.lowercased())") }
    return parts.joined(separator: " ")
  }
}
