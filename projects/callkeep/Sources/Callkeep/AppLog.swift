import Foundation

/// Diagnostic events deliberately exclude audio, transcripts, titles, names, and paths.
@MainActor
final class AppLog {
  enum Event: String {
    case appStarted = "app.started"
    case recordingStarted = "recording.started"
    case recordingSaved = "recording.saved"
    case recordingInterrupted = "recording.interrupted"
    case recordingFailed = "recording.failed"
    case transcriptionStarted = "transcription.started"
    case transcriptionCompleted = "transcription.completed"
    case transcriptionFailed = "transcription.failed"
    case titleStarted = "title.started"
    case titleCompleted = "title.completed"
    case titleGuardrail = "title.blocked_by_model_guardrails"
    case titleContextLimit = "title.context_limit"
    case titleUnavailable = "title.model_unavailable"
    case titleRateLimited = "title.rate_limited"
    case titleUnsupportedLanguage = "title.unsupported_language"
    case titleFailed = "title.failed"
    case updateAvailable = "update.available"
    case updateNotFound = "update.not_found"
    case updateFailed = "update.check_failed"
    case speakerStarted = "speaker_analysis.started"
    case speakerCompleted = "speaker_analysis.completed"
    case speakerFailed = "speaker_analysis.failed"
    case callReminderShown = "call_reminder.shown"
    case callDetectionFailed = "call_reminder.activity_unavailable"
  }
  static let shared: AppLog = {
    #if DEBUG
      if let fixture = Bundle.main.object(forInfoDictionaryKey: "CallkeepScreenshotLibrary")
        as? String
      {
        return AppLog(
          directory: URL(fileURLWithPath: fixture).appendingPathComponent(
            ".diagnostics-preview", isDirectory: true))
      }
    #endif
    return AppLog(
      directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Callkeep/Logs", isDirectory: true))
  }()
  let directory: URL
  private let maxBytes: UInt64
  private var current: URL { directory.appendingPathComponent("callkeep.log") }
  private var previous: URL { directory.appendingPathComponent("callkeep.previous.log") }
  init(directory: URL, maxBytes: UInt64 = 1_000_000) {
    self.directory = directory
    self.maxBytes = maxBytes
  }
  func record(_ event: Event, error: Error? = nil) {
    do {
      let fm = FileManager.default
      try fm.createDirectory(
        at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      if let size = (try? fm.attributesOfItem(atPath: current.path)[.size] as? NSNumber)?
        .uint64Value, size >= maxBytes
      {
        if fm.fileExists(atPath: previous.path) { try fm.removeItem(at: previous) }
        try fm.moveItem(at: current, to: previous)
      }
      if !fm.fileExists(atPath: current.path) {
        guard
          fm.createFile(atPath: current.path, contents: nil, attributes: [.posixPermissions: 0o600])
        else { return }
      }
      let handle = try FileHandle(forWritingTo: current)
      defer { try? handle.close() }
      try handle.seekToEnd()
      var line = "\(ISO8601DateFormatter().string(from: Date()))  \(event.rawValue)"
      if let error {
        let ns = error as NSError
        let category: String
        switch ns.domain {
        case NSURLErrorDomain: category = "network"
        case NSCocoaErrorDomain: category = "cocoa"
        case NSPOSIXErrorDomain: category = "posix"
        case NSOSStatusErrorDomain: category = "os_status"
        case "FoundationModels.LanguageModelError": category = "foundation_models"
        default: category = "other"
        }
        line += "  error=\(category) code=\(ns.code)"
      }
      line += "\n"
      try handle.write(contentsOf: Data(line.utf8))
    } catch { /* Diagnostics must never interrupt recording. */  }
  }
  func contents() -> String {
    let text = [previous, current].compactMap { try? String(contentsOf: $0, encoding: .utf8) }
      .joined()
    return text.isEmpty ? "No diagnostic events yet." : text
  }
}
