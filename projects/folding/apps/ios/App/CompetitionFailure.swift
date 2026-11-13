import Foundation

enum CompetitionTransportError: Error {
  case unavailable, unauthorized, busy, invalidResponse
  case server(Int)
  case service(status: Int, code: String, retryable: Bool, retryAfter: TimeInterval?)
  case unsupportedAttestation

  var statusCode: Int? {
    switch self {
    case .server(let status), .service(let status, _, _, _): return status
    case .unauthorized: return 401
    default: return nil
    }
  }
}
