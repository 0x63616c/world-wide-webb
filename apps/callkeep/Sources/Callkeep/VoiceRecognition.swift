import CallkeepCore
import Foundation
import LocalTranscription
import Observation

struct RememberedVoice: Codable, Identifiable {
  var id: UUID = UUID()
  var name: String
  var embedding: [Float]
}
struct RecordingSpeakers: Codable {
  var analysis: SpeakerAnalysis
  var confirmedNames: [String: String] = [:]
}
private struct VoiceData: Codable {
  var profiles: [RememberedVoice] = []
  var recordings: [String: RecordingSpeakers] = [:]
}

@MainActor @Observable
final class VoiceRecognition {
  var enabled: Bool {
    didSet {
      defaults.set(enabled, forKey: "voiceRecognitionEnabled")
      if !enabled { cancel() }
    }
  }
  private(set) var profiles: [RememberedVoice] = []
  private(set) var recordings: [String: RecordingSpeakers] = [:]
  private(set) var processingID: UUID?
  var error: String?
  var canRun: (() -> Bool)?
  var diagnostic: ((AppLog.Event, Error?) -> Void)?
  private let defaults: UserDefaults
  private let url: URL
  private var task: Task<Void, Never>?
  private var writable = true

  init(root: URL, defaults: UserDefaults = .standard) {
    self.defaults = defaults
    enabled = defaults.bool(forKey: "voiceRecognitionEnabled")
    url = root.appendingPathComponent("VoiceRecognition.json")
    do {
      if FileManager.default.fileExists(atPath: url.path) {
        let data = try JSONDecoder().decode(VoiceData.self, from: Data(contentsOf: url))
        profiles = data.profiles
        recordings = data.recordings
      }
    } catch {
      writable = false
      self.error = "Couldn’t read remembered voices. The original file was kept."
    }
  }
  func analysis(for id: UUID) -> RecordingSpeakers? { recordings[id.uuidString] }
  func suggestedName(for speaker: String, in id: UUID) -> String? {
    guard let vector = analysis(for: id)?.analysis.embeddings[speaker],
      let match = VoiceMatching.candidate(
        for: vector, profiles: profiles.map { ($0.id, $0.embedding) })
    else { return nil }
    return profiles.first { $0.id == match }?.name
  }
  func identify(_ recording: Recording, folder: URL, models: TranscriptionModels) {
    guard enabled, writable, task == nil, analysis(for: recording.id) == nil, canRun?() == true,
      let track = recording.systemAudio, track.duration > 0,
      models.installed.contains(TranscriptionModel.speakers.id)
    else { return }
    error = nil
    processingID = recording.id
    diagnostic?(.speakerStarted, nil)
    task = Task { [weak self] in
      defer {
        self?.processingID = nil
        self?.task = nil
      }
      do {
        try await models.verify(TranscriptionModel.speakers.id)
        let result = try await LocalSpeakerEngine.analyze(
          audio: folder.appendingPathComponent(track.file),
          modelFolder: models.folder(TranscriptionModel.speakers.id), offset: track.startOffset)
        try Task.checkCancellation()
        guard let self, self.enabled, self.canRun?() == true,
          FileManager.default.fileExists(
            atPath: folder.appendingPathComponent("recording.json").path)
        else { return }
        guard !result.turns.isEmpty, !result.embeddings.isEmpty else {
          self.error = "No voices were found in the call audio."
          return
        }
        var next = self.recordings
        next[recording.id.uuidString] = RecordingSpeakers(analysis: result)
        try self.save(profiles: self.profiles, recordings: next)
        self.recordings = next
        self.diagnostic?(.speakerCompleted, nil)
      } catch is CancellationError {} catch {
        self?.diagnostic?(.speakerFailed, error)
        self?.error = "Couldn’t identify speakers: \(error.localizedDescription)"
      }
    }
  }
  func confirm(_ speaker: String, name: String, remember: Bool, in id: UUID) {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, name.count <= 100, var analysis = analysis(for: id),
      let vector = analysis.analysis.embeddings[speaker]
    else { return }
    analysis.confirmedNames[speaker] = name
    var nextRecordings = recordings
    nextRecordings[id.uuidString] = analysis
    var nextProfiles = profiles
    if remember {
      if let index = nextProfiles.firstIndex(where: {
        $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame
      }) {
        nextProfiles[index].embedding = vector
      } else {
        nextProfiles.append(RememberedVoice(name: name, embedding: vector))
      }
    }
    do {
      try save(profiles: nextProfiles, recordings: nextRecordings)
      profiles = nextProfiles
      recordings = nextRecordings
    } catch { self.error = "Couldn’t save the speaker name." }
  }
  func removeProfile(_ id: UUID) {
    let next = profiles.filter { $0.id != id }
    do {
      try save(profiles: next, recordings: recordings)
      profiles = next
    } catch { self.error = "Couldn’t remove the remembered voice." }
  }
  func renameProfile(_ id: UUID, name: String) {
    let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean.count <= 100,
      let index = profiles.firstIndex(where: { $0.id == id }),
      !profiles.contains(where: {
        $0.id != id && $0.name.localizedCaseInsensitiveCompare(clean) == .orderedSame
      })
    else { return }
    var next = profiles
    next[index].name = clean
    do {
      try save(profiles: next, recordings: recordings)
      profiles = next
    } catch { self.error = "Couldn’t rename the remembered voice." }
  }
  func removeRecording(_ id: UUID) {
    guard recordings[id.uuidString] != nil else { return }
    var next = recordings
    next[id.uuidString] = nil
    do {
      try save(profiles: profiles, recordings: next)
      recordings = next
    } catch { self.error = "Couldn’t remove the recording’s local voice data." }
  }
  func clearAll() {
    cancel()
    do {
      try save(profiles: [], recordings: [:])
      profiles = []
      recordings = [:]
    } catch { self.error = "Couldn’t clear voice data." }
  }
  func cancel() { task?.cancel() }
  private func save(profiles: [RememberedVoice], recordings: [String: RecordingSpeakers]) throws {
    guard writable else { throw CocoaError(.fileWriteNoPermission) }
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700], ofItemAtPath: url.deletingLastPathComponent().path)
    try JSONEncoder().encode(VoiceData(profiles: profiles, recordings: recordings)).write(
      to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
}
