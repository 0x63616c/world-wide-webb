import FoldingData
import Foundation

/// TestFlight/debug support metadata. Never accepts arbitrary log messages or payloads.
enum FoldingDiagnostics {
  static var enabled: Bool {
    #if DEBUG
      true
    #else
      Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    #endif
  }

  static func errorInfo(_ error: Error) -> (TrackingDiagnosticEntry.Reason, Int?) {
    if let store = error as? StoreError {
      switch store {
      case .database(let code): return (.database, Int(code))
      case .identityConflict: return (.identityConflict, nil)
      case .invalidInput: return (.invalidInput, nil)
      case .staleGeneration: return (.generationStale, nil)
      default: return (.partition, nil)
      }
    }
    if error is DecodingError { return (.decoding, nil) }
    if error is CancellationError { return (.cancelled, nil) }
    if let transport = error as? CompetitionTransportError {
      switch transport {
      case .unauthorized: return (.unauthorized, nil)
      case .busy: return (.busy, nil)
      case .unavailable: return (.unavailable, nil)
      case .invalidResponse: return (.invalidResponse, nil)
      case .unsupportedAttestation: return (.unsupportedAttestation, nil)
      case .server(let status): return (.service, status)
      case .service(let status, let code, _, _):
        let reason = TrackingDiagnosticEntry.Reason(rawValue: code) ?? .service
        return (reason == .busy ? .service : reason, status)
      }
    }
    if let url = error as? URLError { return (.network, url.code.rawValue) }
    return (.unknown, (error as NSError).code)
  }

  static func record(
    _ store: TrackingStore?, _ event: TrackingDiagnosticEntry.Event,
    error: Error? = nil, count: Int? = nil, durationMS: Int? = nil, attempt: Int? = nil,
    retryDelayMS: Int? = nil
  ) async {
    guard enabled, let store else { return }
    let failure = error.map(errorInfo)
    try? await store.appendDiagnostic(
      TrackingDiagnosticEntry(
        atMS: TrackingRuntime.nowMS, event: event,
        reason: failure?.0, detail: failure?.1, count: count, durationMS: durationMS,
        attempt: attempt, retryDelayMS: retryDelayMS))
  }

  static func attach(to transport: CompetitionTransport, store: TrackingStore) async {
    guard enabled else { return }
    await transport.setDiagnosticRecorder { entry in try? await store.appendDiagnostic(entry) }
  }

  static func route(_ path: String) -> TrackingDiagnosticEntry.Route {
    let path = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    switch path {
    case "/v1/me": return .account
    case "/v1/health", "/v1/capabilities", "/v1/client-policy": return .health
    case "/v1/event-batches": return .events
    case "/v1/history-batches": return .history
    case "/v1/resets": return .reset
    case "/v1/leaderboards": return .leaderboard
    default:
      if path.hasPrefix("/v1/auth/") { return .auth }
      if path.hasPrefix("/v1/attestation/") { return .attestation }
      if path.hasPrefix("/v1/avatars/") { return .avatars }
      if path.hasPrefix("/v1/milestones") { return .milestones }
      if path.hasPrefix("/v1/results") { return .results }
      if path.hasPrefix("/v1/profile") || path.hasPrefix("/v1/participants/") { return .profile }
      if path.hasPrefix("/v1/notifications") || path.hasPrefix("/v1/push/") {
        return .notifications
      }
      return .other
    }
  }
}
