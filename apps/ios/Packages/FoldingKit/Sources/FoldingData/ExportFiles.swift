import FoldingDomain
import Foundation

public enum TrackingExportFormat: String, Codable, Sendable { case json, csv }
public enum TrackingExportError: Error, Equatable {
  case staleSnapshot, missingFile, wrongOwner, filesystem
}

struct TrackingExportSnapshot: Sendable {
  let generation: ResetGeneration
  let events: [TrackingEvent]
  let interruptions: [TrackingInterruption]
  let excludedEventIDs: Set<UUID>
  let uploadStates: [UUID: ExportUploadState]
}

/// A capability owned by the creating export service. Obtain its URL through shareURL immediately
/// before presenting the share sheet; never retain URLs across reset/account-change notifications.
public struct PreparedTrackingExport: Identifiable, Sendable {
  public let id: UUID
  public let format: TrackingExportFormat
  public let generation: ResetGeneration
  public let exportedAtMS: Int64
  let owner: UUID
  let directory: URL
  var fileURL: URL {
    directory.appendingPathComponent(format == .json ? "Folding.json" : "Folding.zip")
  }
}

enum ExportFiles {
  struct Manifest: Codable {
    let exportedAtMS: Int64
    let generation: ResetGeneration
  }

  static func prepare(root: URL, ticket: PreparedTrackingExport) throws {
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var mutableRoot = root
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutableRoot.setResourceValues(values)
    try protect(root)
    try FileManager.default.createDirectory(
      at: ticket.directory, withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700])
    try protect(ticket.directory)
    let manifest = ticket.directory.appendingPathComponent("manifest.json")
    try JSONEncoder().encode(
      Manifest(exportedAtMS: ticket.exportedAtMS, generation: ticket.generation)
    ).write(to: manifest, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: manifest.path)
    try protect(manifest)
  }

  static func write(document: PersonalExportDocument, ticket: PreparedTrackingExport) throws {
    let partial = ticket.directory.appendingPathComponent("output.partial")
    guard
      FileManager.default.createFile(
        atPath: partial.path, contents: nil, attributes: [.posixPermissions: 0o600])
    else { throw TrackingExportError.filesystem }
    try protect(partial)
    let handle = try FileHandle(forWritingTo: partial)
    do {
      if ticket.format == .json {
        try writeJSON(document, to: handle)
      } else {
        try StreamingCSVArchive.write(document, to: handle)
      }
      try Task.checkCancellation()
      try handle.synchronize()
      try handle.close()
      try FileManager.default.moveItem(at: partial, to: ticket.fileURL)
    } catch {
      try? handle.close()
      throw error
    }
  }

  private static func writeJSON(_ document: PersonalExportDocument, to handle: FileHandle) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    func text(_ value: String) throws { try handle.write(contentsOf: Data(value.utf8)) }
    func field<T: Encodable>(_ name: String, _ value: T) throws {
      try Task.checkCancellation()
      try text("\"\(name)\":")
      try handle.write(contentsOf: encoder.encode(value))
      try text(",")
    }
    func array<T: Encodable>(_ name: String, _ values: [T], last: Bool = false) throws {
      try text("\"\(name)\":[")
      for (index, value) in values.enumerated() {
        try Task.checkCancellation()
        if index > 0 { try text(",") }
        try handle.write(contentsOf: encoder.encode(value))
      }
      try text(last ? "]" : "],")
    }
    try text("{")
    try field("schema_version", 1)
    try field("exported_at_ms", document.exportedAtMS)
    try field("generation", document.generation)
    try field("home_timezone", document.homeTimezone)
    try field("reducer_version", TrackingReducer.version)
    try text("\"travel_formula\":{\"version\":1,\"degrees_per_fold\":180,\"radius_metres\":0.1},")
    try array("events", document.events)
    try array("interruptions", document.interruptions)
    try array("transfer_markers", document.transferMarkers)
    try array("sessions", document.sessions)
    try array("daily_summaries", document.dailySummaries, last: true)
    try text("}")
  }

  static func purge(_ directory: URL) throws {
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
  }

  static func clean(root: URL, nowMS: Int64, generation: ResetGeneration) throws {
    guard FileManager.default.fileExists(atPath: root.path) else { return }
    let entries = try FileManager.default.contentsOfDirectory(
      at: root, includingPropertiesForKeys: nil)
    for directory in entries {
      let manifest = try? JSONDecoder().decode(
        Manifest.self, from: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
      if manifest == nil {
        let created = try? directory.resourceValues(forKeys: [.creationDateKey]).creationDate
        if let created, created.timeIntervalSince1970 * 1000 >= Double(nowMS - 86_400_000) {
          continue
        }
      }
      guard let manifest, manifest.generation == generation,
        manifest.exportedAtMS >= 0,
        manifest.exportedAtMS <= TrackingReducer.maximumInteger,
        manifest.exportedAtMS >= nowMS - 86_400_000
      else {
        try purge(directory)
        continue
      }
    }
  }

  private static func protect(_ url: URL) throws {
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    #endif
  }
}
