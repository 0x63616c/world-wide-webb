import AVFoundation
import Foundation

public struct LevelSample: Sendable {
  public let time: TimeInterval
  public let microphone: Float
  public let systemAudio: Float
  public init(time: TimeInterval, microphone: Float, systemAudio: Float) {
    self.time = time
    self.microphone = microphone
    self.systemAudio = systemAudio
  }
}

public struct AudioTrack: Codable, Equatable, Sendable {
  public var file: String
  public var startOffset: TimeInterval
  public var duration: TimeInterval
  public var sampleRate: Double
  public var channels: UInt32
  public init(
    file: String, startOffset: TimeInterval, duration: TimeInterval, sampleRate: Double,
    channels: UInt32
  ) {
    self.file = file
    self.startOffset = startOffset
    self.duration = duration
    self.sampleRate = sampleRate
    self.channels = channels
  }
}

public struct Recording: Identifiable, Codable, Equatable, Sendable {
  public enum State: String, Codable, Sendable { case recording, saved, interrupted }
  public let id: UUID
  public var title: String
  public let createdAt: Date
  public var duration: TimeInterval
  public var state: State
  public var microphone: AudioTrack?
  public var systemAudio: AudioTrack?
  public var note: String?
  public var suggestedTitle: String?
  public var titleSuggestionDismissed: Bool?
  public var schemaVersion = 1
  public init(id: UUID = UUID(), title: String, createdAt: Date = .now) {
    self.id = id
    self.title = title
    self.createdAt = createdAt
    duration = 0
    state = .recording
  }
  public var interruptionDetail: String? {
    // Older releases mistook an engine configuration change for a disconnect.
    if note == "Microphone disconnected. Your recording was saved." {
      return "The microphone input stopped. Audio captured before the interruption was saved."
    }
    return note
  }
  public var formattedDuration: String { Self.timeString(duration) }
  public static func timeString(_ duration: TimeInterval) -> String {
    let seconds = max(0, Int(duration.isFinite ? duration : 0))
    return seconds >= 3600
      ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
      : String(format: "%d:%02d", seconds / 60, seconds % 60)
  }
}

public final class RecordingStore {
  public let root: URL
  public var archiveRoot: URL?
  public var legacyArchiveRoots: [URL] = []
  public var usesUbiquityContainer = false
  public private(set) var warnings: [String] = []
  private let fm = FileManager.default
  public init(root: URL) throws {
    self.root = root
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
  }
  public func folder(for recording: Recording) -> URL {
    let local = root.appendingPathComponent(recording.id.uuidString, isDirectory: true)
    if fm.fileExists(atPath: local.path) { return local }
    for archive in [archiveRoot].compactMap({ $0 }) + legacyArchiveRoots {
      let archived = archive.appendingPathComponent(recording.id.uuidString, isDirectory: true)
      if fm.fileExists(atPath: archived.path) { return archived }
    }
    return local
  }
  /// Only closed recordings may leave the local capture directory. A failed move
  /// leaves the original in place and never replaces an existing cloud recording.
  public func archive(_ recording: Recording) throws {
    guard recording.state != .recording, let archiveRoot else { return }
    let source = folder(for: recording)
    let destination = archiveRoot.appendingPathComponent(recording.id.uuidString, isDirectory: true)
    guard source.standardizedFileURL != destination.standardizedFileURL,
      fm.fileExists(atPath: source.path)
    else { return }
    guard !fm.fileExists(atPath: destination.path) else { throw CocoaError(.fileWriteFileExists) }
    try fm.createDirectory(at: archiveRoot, withIntermediateDirectories: true)
    guard usesUbiquityContainer else {
      try fm.moveItem(at: source, to: destination)
      return
    }
    precondition(!Thread.isMainThread, "iCloud transfers must run off the main thread")
    if fm.isUbiquitousItem(at: source) {
      var coordinationError: NSError?
      var transferError: Error?
      let coordinator = NSFileCoordinator()
      coordinator.coordinate(
        writingItemAt: source, options: .forMoving,
        writingItemAt: destination, options: [], error: &coordinationError
      ) { from, to in
        do {
          try fm.moveItem(at: from, to: to)
          coordinator.item(at: from, didMoveTo: to)
        } catch { transferError = error }
      }
      if let error = transferError ?? coordinationError { throw error }
    } else {
      // setUbiquitous performs its own coordinated move into iCloud.
      try fm.setUbiquitous(true, itemAt: source, destinationURL: destination)
    }
  }
  public func save(_ recording: Recording) throws {
    let folder = folder(for: recording)
    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(recording).write(
      to: folder.appendingPathComponent("recording.json"), options: .atomic)
  }
  public func load(recover: Bool = true) throws -> [Recording] {
    warnings = []
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    var recordings: [Recording] = []
    for folder in try fm.contentsOfDirectory(
      at: root, includingPropertiesForKeys: [.isDirectoryKey], options: .skipsHiddenFiles)
    {
      guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
        continue
      }
      do {
        var recording = try decoder.decode(
          Recording.self, from: Data(contentsOf: folder.appendingPathComponent("recording.json")))
        guard folder.lastPathComponent == recording.id.uuidString else {
          throw CocoaError(.fileReadCorruptFile)
        }
        if recover && recording.state == .recording {
          recording.state = .interrupted
          recording.note = "Recording was interrupted. Available audio has been kept."
          recording.microphone = Self.inspect(
            folder.appendingPathComponent("microphone.caf"),
            offset: recording.microphone?.startOffset ?? 0)
          recording.systemAudio = Self.inspect(
            folder.appendingPathComponent("system-audio.caf"),
            offset: recording.systemAudio?.startOffset ?? 0)
          recording.duration = max(
            recording.microphone.map { $0.startOffset + $0.duration } ?? 0,
            recording.systemAudio.map { $0.startOffset + $0.duration } ?? 0)
          try save(recording)
        }
        recordings.append(recording)
      } catch {
        warnings.append("Couldn’t read \(folder.lastPathComponent). Its files are still on disk.")
      }
    }
    for archiveRoot in [archiveRoot].compactMap({ $0 }) + legacyArchiveRoots
    where fm.fileExists(atPath: archiveRoot.path) {
      do {
        let archive = try RecordingStore(root: archiveRoot)
        let archived = try archive.load(recover: false)
        let knownIDs = Set(recordings.map(\.id))
        recordings += archived.filter { !knownIDs.contains($0.id) }
        warnings += archive.warnings
      } catch {
        warnings.append(
          "Couldn’t read iCloud Drive. Local recordings are still available: \(error.localizedDescription)"
        )
      }
    }
    return recordings.sorted { $0.createdAt > $1.createdAt }
  }
  public static func inspect(_ url: URL, offset: TimeInterval) -> AudioTrack? {
    guard let file = try? AVAudioFile(forReading: url), file.length > 0 else { return nil }
    return AudioTrack(
      file: url.lastPathComponent, startOffset: offset,
      duration: Double(file.length) / file.fileFormat.sampleRate,
      sampleRate: file.fileFormat.sampleRate, channels: file.fileFormat.channelCount)
  }
}
