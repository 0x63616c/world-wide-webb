import CallkeepCore
import Darwin
import Foundation

/// Container resolution and coordinated transfers can block; never run on the UI thread.
enum ICloudDocuments {
  static let identifier = "iCloud.co.calum.callkeep"
  private struct LibraryHeader: Codable {
    let schemaVersion: Int
  }
  struct Snapshot: Sendable {
    let documents: URL?
    let recordings: [Recording]
    let warnings: [String]
  }
  static func resolve() async -> URL? {
    await Task.detached(priority: .utility) {
      FileManager.default.url(forUbiquityContainerIdentifier: identifier)?.appendingPathComponent(
        "Documents", isDirectory: true)
    }.value
  }
  static func prepare(localRoot: URL, legacyRoot: URL, documents: URL?, enabled: Bool) async throws
    -> Snapshot
  {
    try await Task.detached(priority: .utility) {
      let fm = FileManager.default
      if enabled, let documents {
        try fm.createDirectory(at: documents, withIntermediateDirectories: true)
        // Native app folders are published after their first document.
        // A hidden format header identifies the library without adding
        // a fake recording or a visible placeholder to the user’s files.
        let header = documents.appendingPathComponent(".callkeep-library.json")
        if fm.fileExists(atPath: header.path) {
          let library = try JSONDecoder().decode(LibraryHeader.self, from: Data(contentsOf: header))
          guard library.schemaVersion == 1 else {
            throw RecordingImportError("This iCloud library uses an unsupported format version.")
          }
        } else {
          let staging = localRoot.appendingPathComponent(".icloud-library-" + UUID().uuidString)
          defer { try? fm.removeItem(at: staging) }
          try JSONEncoder().encode(LibraryHeader(schemaVersion: 1)).write(
            to: staging, options: .atomic)
          try fm.setUbiquitous(true, itemAt: staging, destinationURL: header)
        }
      }
      let store = try RecordingStore(root: localRoot)
      store.archiveRoot = documents.flatMap { fm.fileExists(atPath: $0.path) ? $0 : nil }
      store.legacyArchiveRoots = [legacyRoot]
      store.usesUbiquityContainer = true
      let recordings = try store.load(recover: false)
      var transferWarnings: [String] = []
      if enabled, store.archiveRoot != nil {
        for recording in recordings where recording.state != .recording {
          do { try store.archive(recording) } catch {
            transferWarnings.append(
              "Couldn’t move \(recording.title) to iCloud. Its existing files were kept: \(error.localizedDescription)"
            )
          }
        }
      }
      let refreshed = try store.load(recover: false)
      if enabled, store.archiveRoot != nil {
        // rmdir only succeeds when empty; a concurrent import or any
        // unknown legacy files keep the original folder intact.
        _ = legacyRoot.withUnsafeFileSystemRepresentation { path in path.map { rmdir($0) } ?? -1 }
      }
      return Snapshot(
        documents: store.archiveRoot, recordings: refreshed,
        warnings: transferWarnings + store.warnings)
    }.value
  }
}
