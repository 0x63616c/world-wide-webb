import CryptoKit
import Foundation
import Observation

struct TranscriptionModel: Identifiable, Sendable {
  let id: String
  let name: String
  let detail: String
  let revision: String
  static let all = [
    Self(
      id: "parakeet-ultra", name: "Parakeet Ultra", detail: "632 MB · 25 languages",
      revision: "95eaa59a39d4394f047a4dc5cce480388a60d1b6"),
    Self(
      id: "whisper-turbo", name: "Whisper Turbo", detail: "629 MB · English transcription",
      revision: "0f63a7800b00dd0226abd051b906c246e1907482"),
  ]
  static let speakers = Self(
    id: "speaker-diarization", name: "Speaker recognition", detail: "22 MB · on-device",
    revision: "7eab74f3463c736418d0eb10296261ae581146c9")
  static var downloadable: [Self] { all + [speakers] }
  static func find(_ id: String) -> Self? { downloadable.first { $0.id == id } }
  static var supported: Bool {
    #if arch(arm64)
      true
    #else
      false
    #endif
  }
}
struct ModelDownloadFile: Codable, Sendable {
  let repo: String
  let revision: String
  let path: String
  let localPath: String
  let size: Int64
  let sha256: String?
  let gitSHA: String?
  func verify(_ url: URL) throws -> Bool {
    guard let sizeOnDisk = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      Int64(sizeOnDisk) == size
    else { return false }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var sha = SHA256()
    var git = Insecure.SHA1()
    git.update(data: Data("blob \(size)\0".utf8))
    while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
      try Task.checkCancellation()
      sha.update(data: data)
      git.update(data: data)
    }
    let digest =
      sha256 == nil
      ? git.finalize().map { String(format: "%02x", $0) }.joined()
      : sha.finalize().map { String(format: "%02x", $0) }.joined()
    return digest == (sha256 ?? gitSHA)
  }
}
private final class DownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
  let update: @Sendable (Int64) -> Void
  init(_ update: @escaping @Sendable (Int64) -> Void) { self.update = update }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    update(totalBytesWritten)
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {}
}

@MainActor @Observable
final class TranscriptionModels {
  let root: URL
  private(set) var installed: Set<String> = []
  private(set) var downloading: String?
  private(set) var progress: Double = 0
  private(set) var bytesPerSecond: Double = 0
  private var lastProgressBytes: Int64 = 0
  private var lastProgressTime: TimeInterval = 0
  private func received(_ bytes: Int64, total: Int64, networkBytes: Int64) {
    progress = min(1, Double(bytes) / Double(total))
    let now = ProcessInfo.processInfo.systemUptime
    let elapsed = now - lastProgressTime
    if elapsed >= 0.5 {
      let speed = Double(max(0, networkBytes - lastProgressBytes)) / elapsed
      bytesPerSecond = bytesPerSecond == 0 ? speed : bytesPerSecond * 0.35 + speed * 0.65
      lastProgressBytes = networkBytes
      lastProgressTime = now
    }
  }
  var error: String?
  private var task: Task<Void, Never>?
  private let manifestURL: URL?
  var didChange: (() -> Void)?
  init(root: URL, manifestURL: URL? = nil) {
    self.root = root
    self.manifestURL = manifestURL
    refresh()
  }
  func folder(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }
  func refresh() {
    installed = Set(
      TranscriptionModel.downloadable.filter { model in
        (try? String(
          contentsOf: folder(model.id).appendingPathComponent(".installed"), encoding: .utf8))
          == model.revision
      }.map(\.id))
  }
  func files(_ id: String) throws -> [ModelDownloadFile] {
    guard
      let url = manifestURL
        ?? Bundle.main.url(forResource: "TranscriptionModels", withExtension: "json"),
      let files = try JSONDecoder().decode(
        [String: [ModelDownloadFile]].self, from: Data(contentsOf: url))[id],
      !files.isEmpty
    else { throw CocoaError(.fileReadCorruptFile) }
    return files
  }
  func download(_ id: String) {
    guard task == nil, TranscriptionModel.supported, let model = TranscriptionModel.find(id) else {
      return
    }
    downloading = id
    progress = 0
    bytesPerSecond = 0
    lastProgressBytes = 0
    lastProgressTime = ProcessInfo.processInfo.systemUptime
    error = nil
    task = Task {
      defer {
        task = nil
        downloading = nil
        refresh()
        didChange?()
      }
      do {
        let files = try files(id)
        let staging = root.appendingPathComponent(".download-" + id, isDirectory: true)
        let destination = folder(id)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try await Task.detached(priority: .utility) { [self] in
          let total = max(1, files.reduce(Int64(0)) { $0 + $1.size })
          var completed: Int64 = 0
          var transferred: Int64 = 0
          for file in files {
            try Task.checkCancellation()
            guard !file.localPath.hasPrefix("/"),
              !file.localPath.split(separator: "/").contains("..")
            else { throw CocoaError(.fileWriteInvalidFileName) }
            let target = staging.appendingPathComponent(file.localPath)
            if try !file.verify(target) {
              let base = completed
              let networkBase = transferred
              let delegate = DownloadProgress { bytes in
                Task { @MainActor in
                  self.received(base + bytes, total: total, networkBytes: networkBase + bytes)
                }
              }
              let url = URL(
                string: "https://huggingface.co/\(file.repo)/resolve/\(file.revision)/\(file.path)")!
              let (temporary, response) = try await URLSession.shared.download(
                from: url, delegate: delegate)
              defer { try? FileManager.default.removeItem(at: temporary) }
              guard (response as? HTTPURLResponse)?.statusCode == 200, try file.verify(temporary)
              else {
                throw NSError(
                  domain: "Callkeep", code: 1,
                  userInfo: [
                    NSLocalizedDescriptionKey:
                      "Model download failed verification. Retry the download."
                  ])
              }
              try FileManager.default.createDirectory(
                at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
              if FileManager.default.fileExists(atPath: target.path) {
                try FileManager.default.removeItem(at: target)
              }
              try FileManager.default.moveItem(at: temporary, to: target)
              transferred += file.size
            }
            completed += file.size
            let fraction = Double(completed) / Double(total)
            await MainActor.run { self.progress = fraction }
          }
          try Task.checkCancellation()
          try model.revision.write(
            to: staging.appendingPathComponent(".installed"), atomically: true, encoding: .utf8)
          if FileManager.default.fileExists(atPath: destination.path) {
            throw CocoaError(.fileWriteFileExists)
          }
          try FileManager.default.moveItem(at: staging, to: destination)
        }.valueWithCancellation()
      } catch is CancellationError {} catch {
        if !Task.isCancelled { self.error = error.localizedDescription }
      }
    }
  }
  func cancelDownload() { task?.cancel() }
  func remove(_ id: String) {
    guard downloading != id else { return }
    do {
      try FileManager.default.trashItem(at: folder(id), resultingItemURL: nil)
      refresh()
      didChange?()
    } catch { self.error = error.localizedDescription }
  }
  func verify(_ id: String) async throws {
    let files = try files(id)
    let folder = folder(id)
    try await Task.detached(priority: .utility) {
      for file in files {
        guard try file.verify(folder.appendingPathComponent(file.localPath)) else {
          throw NSError(
            domain: "Callkeep", code: 2,
            userInfo: [
              NSLocalizedDescriptionKey:
                "The model is incomplete or damaged. Remove it in Settings and download it again."
            ])
        }
      }
    }.valueWithCancellation()
  }
}

extension Task where Failure == Error {
  func valueWithCancellation() async throws -> Success {
    try await withTaskCancellationHandler {
      try await value
    } onCancel: {
      cancel()
    }
  }
}
