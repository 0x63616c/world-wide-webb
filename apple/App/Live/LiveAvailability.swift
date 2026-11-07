import PanelKit

enum LiveAvailability: Equatable, Sendable {
    case loading
    case live
    case unavailable(String)
}

/// Do not display localizedDescription: transport/server errors can contain secrets.
func panelFailureReason(_ error: any Error, fallback: String) -> String {
    guard let error = error as? PanelAPIError else { return fallback }
    switch error {
    case .notConfigured: return "Panel server isn't configured"
    case .http(let status): return "Can't reach server (HTTP \(status))"
    case .server(_, _, let status):
        return status.map { "Can't reach server (HTTP \($0))" } ?? fallback
    case .transport: return "Can't reach server"
    case .decoding: return "Server response couldn't be read"
    }
}
