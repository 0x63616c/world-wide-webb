import Foundation

/// A live authorization result. Missing API support never implies a grant.
public enum AudioPermissionState: Equatable, Sendable {
    case allowed, denied, notDetermined, unavailable

    public static func preflightResult(_ result: Int?) -> Self {
        switch result {
        case 0: .allowed
        case 1: .denied
        case 2: .notDetermined
        default: .unavailable
        }
    }
}
