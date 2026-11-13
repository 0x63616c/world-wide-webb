import Foundation

/// A live authorization result. Missing API support never implies a grant.
public enum AudioPermissionState: Equatable, Sendable {
  case allowed, denied, notDetermined, unavailable

  /// Screen-and-audio access also permits Core Audio taps. Its grant can
  /// precede the audio-only TCC entry, which macOS resolves on first capture.
  public static func systemAudioAccess(audioOnlyResult: Int?, screenCaptureAllowed: Bool) -> Self {
    screenCaptureAllowed ? .allowed : preflightResult(audioOnlyResult)
  }

  public static func preflightResult(_ result: Int?) -> Self {
    switch result {
    case 0: .allowed
    case 1: .denied
    case 2: .notDetermined
    default: .unavailable
    }
  }
}
