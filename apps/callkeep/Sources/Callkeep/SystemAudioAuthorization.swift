import CallkeepCore
import CoreGraphics
import Darwin
import Foundation

/// macOS currently has no public, audio-only authorization query. Keep this
/// read-only SPI optional and isolated; capture itself still uses Core Audio.
/// If Apple removes it, setup remains available and capture requests consent.
final class SystemAudioAuthorization {
  private typealias Query = @convention(c) (CFString, CFDictionary?) -> Int
  private let handle: UnsafeMutableRawPointer?
  private let query: Query?

  init() {
    let library = dlopen(
      "/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_LAZY | RTLD_LOCAL)
    handle = library
    if let library, let symbol = dlsym(library, "TCCAccessPreflight") {
      query = unsafeBitCast(symbol, to: Query.self)
    } else {
      query = nil
    }
  }

  var status: AudioPermissionState {
    let audio = query?("kTCCServiceAudioCapture" as CFString, nil)
    if AudioPermissionState.preflightResult(audio) == .allowed { return .allowed }
    return .systemAudioAccess(
      audioOnlyResult: audio, screenCaptureAllowed: CGPreflightScreenCaptureAccess())
  }

  deinit { if let handle { dlclose(handle) } }
}
