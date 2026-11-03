import Foundation

public enum TranscriptSource: String, Codable, Sendable, CaseIterable {
    case microphone, systemAudio
    public var label: String { self == .microphone ? "You" : "Call audio" }
}
public struct TranscriptSegment: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var source: TranscriptSource
    public var start: Double
    public var end: Double
    public var text: String
    public init(source: TranscriptSource, start: Double, end: Double, text: String) {
        id = UUID(); self.source = source; self.start = start; self.end = end; self.text = text
    }
}
public struct Transcript: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var recordingID: UUID
    public var modelID: String
    public var modelName: String
    public var revision: String
    public var createdAt: Date
    public var processingSeconds: Double
    public var segments: [TranscriptSegment]
    public init(recordingID: UUID, modelID: String, modelName: String, revision: String,
                processingSeconds: Double, segments: [TranscriptSegment]) {
        id = UUID(); self.recordingID = recordingID; self.modelID = modelID; self.modelName = modelName
        self.revision = revision; createdAt = .now; self.processingSeconds = processingSeconds
        self.segments = segments.sorted { $0.start == $1.start ? $0.source.rawValue < $1.source.rawValue : $0.start < $1.start }
    }
    public var plainText: String {
        segments.map { "[\(Recording.timeString($0.start))] \($0.source.label): \($0.text)" }.joined(separator: "\n\n")
    }
}
public enum TranscriptFiles {
    public static func save(_ transcript: Transcript, folder: URL) throws {
        // Do not recreate a recording that the user has moved or trashed.
        guard FileManager.default.fileExists(atPath: folder.appendingPathComponent("recording.json").path) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let root = folder.appendingPathComponent("Transcripts", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(transcript).write(to: root.appendingPathComponent(transcript.id.uuidString + ".json"), options: .atomic)
    }
    public static func load(folder: URL) throws -> [Transcript] {
        let root = folder.appendingPathComponent("Transcripts", isDirectory: true)
        guard FileManager.default.fileExists(atPath: root.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(Transcript.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }
}

public struct TranscriptionJob: Codable, Equatable, Identifiable, Sendable {
    public enum State: String, Codable, Sendable { case queued, failed }
    public var id: UUID
    public var recordingID: UUID
    public var modelID: String
    public var state: State = .queued
    public var error: String?
    public var nextChunks: [TranscriptSource: Int] = [:]
    public var segments: [TranscriptSegment] = []
    public var processingSeconds: Double = 0
    // Fixed up front so a crash after result saving can safely repeat completion.
    public var resultID = UUID()
    public init(recordingID: UUID, modelID: String) {
        id = UUID(); self.recordingID = recordingID; self.modelID = modelID
    }
}
public enum TranscriptionQueueFile {
    public static func load(_ url: URL) throws -> [TranscriptionJob] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([TranscriptionJob].self, from: Data(contentsOf: url))
    }
    public static func save(_ jobs: [TranscriptionJob], to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(jobs).write(to: url, options: .atomic)
    }
}
