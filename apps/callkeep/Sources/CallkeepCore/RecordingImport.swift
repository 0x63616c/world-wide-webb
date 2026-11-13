import Foundation

public struct RecordingImportError: LocalizedError {
  public let message: String
  public var errorDescription: String? { message }
  public init(_ message: String) { self.message = message }
}

extension RecordingStore {
  /// Accept an individual recording folder or a library containing recording folders.
  public static func importCandidates(in directory: URL) throws -> [URL] {
    try validateImportDirectory(directory)
    let fm = FileManager.default
    if fm.fileExists(atPath: directory.appendingPathComponent("recording.json").path) {
      return [directory]
    }
    let folders = try fm.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
      options: .skipsHiddenFiles
    )
    .filter {
      (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        && fm.fileExists(atPath: $0.appendingPathComponent("recording.json").path)
    }
    guard !folders.isEmpty else {
      throw RecordingImportError(
        "Choose a Callkeep recording folder or a folder containing recordings.")
    }
    return folders.sorted { $0.lastPathComponent < $1.lastPathComponent }
  }

  /// Copy into a hidden staging directory, validate, then publish atomically.
  /// Originals and existing recordings are never replaced. nil means duplicate.
  public func importRecordingFolder(at source: URL) throws -> Recording? {
    let fm = FileManager.default
    try Self.validateImportDirectory(source)
    try Self.validateImportTree(source)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let recording = try decoder.decode(
      Recording.self, from: Data(contentsOf: source.appendingPathComponent("recording.json")))
    guard recording.schemaVersion == 1 else {
      throw RecordingImportError("This recording uses an unsupported format version.")
    }
    guard recording.state != .recording else {
      throw RecordingImportError("Stop the recording before importing its folder.")
    }
    guard recording.duration.isFinite, recording.duration >= 0 else {
      throw RecordingImportError("The recording metadata is invalid.")
    }
    for track in [recording.microphone, recording.systemAudio].compactMap({ $0 }) {
      guard !track.file.isEmpty, track.file != ".", track.file != "..",
        URL(fileURLWithPath: track.file).lastPathComponent == track.file,
        !track.file.contains("/"), track.startOffset.isFinite, track.startOffset >= 0
      else {
        throw RecordingImportError("The recording contains an invalid audio file reference.")
      }
    }
    if fm.fileExists(atPath: folder(for: recording).path) { return nil }
    let staging = root.appendingPathComponent(".import-" + UUID().uuidString, isDirectory: true)
    defer { try? fm.removeItem(at: staging) }
    try fm.copyItem(at: source, to: staging)
    try Self.validateImportTree(staging)
    var imported = try decoder.decode(
      Recording.self, from: Data(contentsOf: staging.appendingPathComponent("recording.json")))
    guard imported == recording else {
      throw RecordingImportError("The recording changed while it was being imported. Try again.")
    }
    func inspect(_ track: AudioTrack?, defaultFile: String) throws -> AudioTrack? {
      let url = staging.appendingPathComponent(track?.file ?? defaultFile)
      guard fm.fileExists(atPath: url.path) else {
        if track != nil {
          throw RecordingImportError("An audio file referenced by this recording is missing.")
        }
        return nil
      }
      guard let actual = Self.inspect(url, offset: track?.startOffset ?? 0) else {
        throw RecordingImportError("An audio file in this recording can’t be read.")
      }
      return actual
    }
    imported.microphone = try inspect(imported.microphone, defaultFile: "microphone.caf")
    imported.systemAudio = try inspect(imported.systemAudio, defaultFile: "system-audio.caf")
    guard imported.microphone != nil || imported.systemAudio != nil else {
      throw RecordingImportError("This folder contains no playable recording audio.")
    }
    imported.duration = max(
      imported.microphone.map { $0.startOffset + $0.duration } ?? 0,
      imported.systemAudio.map { $0.startOffset + $0.duration } ?? 0)
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(imported).write(
      to: staging.appendingPathComponent("recording.json"), options: .atomic)
    try fm.moveItem(
      at: staging, to: root.appendingPathComponent(imported.id.uuidString, isDirectory: true))
    return imported
  }

  private static func validateImportTree(_ directory: URL) throws {
    var failure: Error?
    let files = FileManager.default.enumerator(
      at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey],
      errorHandler: { _, error in
        failure = error
        return false
      })
    if let files {
      for case let file as URL in files {
        if try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
          throw RecordingImportError(
            "Recording folders containing symbolic links can’t be imported.")
        }
      }
    }
    if let failure { throw failure }
  }

  private static func validateImportDirectory(_ url: URL) throws {
    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else {
      throw RecordingImportError("Choose a recording folder, not a symbolic link.")
    }
  }
}
