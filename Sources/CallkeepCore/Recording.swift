import Foundation
import AVFoundation

public struct AudioTrack: Codable, Equatable, Sendable {
    public var file: String
    public var startOffset: TimeInterval
    public var duration: TimeInterval
    public var sampleRate: Double
    public var channels: UInt32
    public init(file: String, startOffset: TimeInterval, duration: TimeInterval, sampleRate: Double, channels: UInt32) {
        self.file = file; self.startOffset = startOffset; self.duration = duration
        self.sampleRate = sampleRate; self.channels = channels
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
    public var schemaVersion = 1
    public init(id: UUID = UUID(), title: String, createdAt: Date = .now) {
        self.id = id; self.title = title; self.createdAt = createdAt
        duration = 0; state = .recording
    }
    public var formattedDuration: String { Self.timeString(duration) }
    public static func timeString(_ duration: TimeInterval) -> String {
        let seconds = max(0, Int(duration.isFinite ? duration : 0))
        return seconds >= 3600 ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) : String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

public final class RecordingStore {
    public let root: URL
    public private(set) var warnings: [String] = []
    private let fm = FileManager.default
    public init(root: URL) throws {
        self.root = root
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
    }
    public func folder(for recording: Recording) -> URL { root.appendingPathComponent(recording.id.uuidString, isDirectory: true) }
    public func save(_ recording: Recording) throws {
        let folder = folder(for: recording)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(recording).write(to: folder.appendingPathComponent("recording.json"), options: .atomic)
    }
    public func load(recover: Bool = true) throws -> [Recording] {
        warnings = []
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        var recordings: [Recording] = []
        for folder in try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: .skipsHiddenFiles) {
            guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            do {
                var recording = try decoder.decode(Recording.self, from: Data(contentsOf: folder.appendingPathComponent("recording.json")))
                guard folder.lastPathComponent == recording.id.uuidString else { throw CocoaError(.fileReadCorruptFile) }
                if recover && recording.state == .recording {
                    recording.state = .interrupted
                    recording.note = "Recording was interrupted. Available audio has been kept."
                    recording.microphone = Self.inspect(folder.appendingPathComponent("microphone.caf"), offset: recording.microphone?.startOffset ?? 0)
                    recording.systemAudio = Self.inspect(folder.appendingPathComponent("system-audio.caf"), offset: recording.systemAudio?.startOffset ?? 0)
                    recording.duration = max(recording.microphone.map { $0.startOffset + $0.duration } ?? 0, recording.systemAudio.map { $0.startOffset + $0.duration } ?? 0)
                    try save(recording)
                }
                recordings.append(recording)
            } catch { warnings.append("Couldn’t read \(folder.lastPathComponent). Its files are still on disk.") }
        }
        return recordings.sorted { $0.createdAt > $1.createdAt }
    }
    public static func inspect(_ url: URL, offset: TimeInterval) -> AudioTrack? {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0 else { return nil }
        return AudioTrack(file: url.lastPathComponent, startOffset: offset, duration: Double(file.length) / file.fileFormat.sampleRate, sampleRate: file.fileFormat.sampleRate, channels: file.fileFormat.channelCount)
    }
}
