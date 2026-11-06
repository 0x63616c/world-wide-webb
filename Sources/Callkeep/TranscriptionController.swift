import Foundation
import Observation
import CallkeepCore
import LocalTranscription

@MainActor @Observable
final class TranscriptionController {
    let models: TranscriptionModels
    private(set) var jobs: [TranscriptionJob] = []
    private(set) var runningID: UUID?
    private(set) var runningModelID: String?
    private(set) var progress = ""
    private(set) var progressFraction: Double?
    private(set) var resultsVersion = 0
    var error: String?
    var automatic: Bool { didSet { defaults.set(automatic, forKey: "automaticTranscription") } }
    var selectedModelID: String { didSet { defaults.set(selectedModelID, forKey: "transcriptionModel") } }
    var notifyWhenReady: Bool { didSet { defaults.set(notifyWhenReady, forKey: "notifyWhenTranscriptReady") } }
    var requestNotifications: (() -> Void)?
    var didComplete: ((UUID) -> Void)?
    var transcriptCompleted: ((Transcript) -> Void)?
    var recording: ((UUID) -> (Recording, URL)?)?
    var canRun: (() -> Bool)?
    var didFinish: (() -> Void)?
    private let defaults: UserDefaults
    private let queueURL: URL
    private let engine: any SpeechEngine
    private var worker: Task<Void, Never>?
    private var suspended = false
    private var queueWritable = true
    var isRunning: Bool { worker != nil }
    var isPaused: Bool { suspended }
    init(root: URL, defaults: UserDefaults = .standard, engine: any SpeechEngine = LocalSpeechEngine(), manifestURL: URL? = nil) {
        self.engine = engine
        self.defaults = defaults
        notifyWhenReady = defaults.object(forKey: "notifyWhenTranscriptReady") as? Bool ?? true
        automatic = defaults.object(forKey: "automaticTranscription") as? Bool ?? true
        let preferred = defaults.string(forKey: "transcriptionModel") ?? "parakeet-ultra"
        selectedModelID = TranscriptionModel.find(preferred) == nil ? "parakeet-ultra" : preferred
        models = TranscriptionModels(root: root.appendingPathComponent("Models", isDirectory: true), manifestURL: manifestURL)
        queueURL = root.appendingPathComponent("Transcription/queue.json")
        do { jobs = try TranscriptionQueueFile.load(queueURL) }
        catch {
            self.error = "The transcription queue couldn’t be read. Its original file has been kept."
            // Preserve recoverable progress rather than silently overwriting a bad queue.
            let backup = queueURL.deletingLastPathComponent().appendingPathComponent("queue-\(UUID().uuidString).json")
            do { try FileManager.default.moveItem(at: queueURL, to: backup) }
            catch { queueWritable = false; self.error = "The transcription queue is unavailable: \(error.localizedDescription)" }
        }
        models.didChange = { [weak self] in self?.kick() }
    }
    func enqueue(_ recording: Recording, modelID: String? = nil, automatic: Bool = false) {
        guard queueWritable, recording.state != .recording, recording.duration.isFinite, recording.duration > 0,
              !automatic || self.automatic else { return }
        let id = modelID ?? selectedModelID
        guard TranscriptionModel.find(id) != nil, !jobs.contains(where: { $0.recordingID == recording.id && $0.modelID == id }) else { return }
        let job = TranscriptionJob(recordingID: recording.id, modelID: id)
        jobs.append(job)
        do {
            try TranscriptionQueueFile.save(jobs, to: queueURL)
            if notifyWhenReady { requestNotifications?() }
            kick()
        }
        catch {
            jobs.removeAll { $0.id == job.id }
            self.error = "Couldn’t queue transcription: \(error.localizedDescription)"
        }
    }
    func status(for id: UUID) -> String? {
        guard let job = jobs.first(where: { $0.recordingID == id }) else { return nil }
        if runningID == id { return suspended ? "Paused while recording" : progress }
        if job.state == .failed { return job.error ?? "Transcription failed" }
        if !TranscriptionModel.supported { return "Transcription requires Apple silicon" }
        if !models.installed.contains(job.modelID) { return "Download \(TranscriptionModel.find(job.modelID)?.name ?? "the model") in Settings" }
        return suspended ? "Paused while recording" : "Queued for transcription"
    }
    func retry(_ id: UUID) {
        for index in jobs.indices where jobs[index].recordingID == id {
            jobs[index].state = .queued; jobs[index].error = nil
        }
        persist(); kick()
    }
    func cancel(_ id: UUID) {
        if runningID == id { worker?.cancel() }
        jobs.removeAll { $0.recordingID == id }; persist()
    }
    func setSuspended(_ value: Bool) {
        suspended = value
        if value { worker?.cancel() } else { kick() }
    }
    private func persist() {
        do { try TranscriptionQueueFile.save(jobs, to: queueURL) }
        catch { self.error = "Couldn’t save transcription progress: \(error.localizedDescription)" }
    }
    private func checkpoint(_ job: TranscriptionJob) throws {
        guard let index = jobs.firstIndex(where: { $0.id == job.id }) else { throw CancellationError() }
        var updated = jobs; updated[index] = job
        try TranscriptionQueueFile.save(updated, to: queueURL)
        jobs = updated
    }
    func kick() {
        guard worker == nil, !suspended, canRun?() == true, TranscriptionModel.supported,
              let job = jobs.first(where: { $0.state == .queued && models.installed.contains($0.modelID) }) else { return }
        runningID = job.recordingID; runningModelID = job.modelID; progress = "Loading model…"
        progressFraction = nil
        worker = Task {
            await process(job)
            await engine.unload()
            worker = nil; runningID = nil; runningModelID = nil; progress = ""
            progressFraction = nil
            didFinish?()
            kick()
        }
    }
    private func process(_ original: TranscriptionJob) async {
        var job = original
        do {
            guard let model = TranscriptionModel.find(job.modelID), let (record, _) = recording?(job.recordingID),
                  record.state != .recording else { throw CocoaError(.fileNoSuchFile) }
            try await models.verify(model.id)
            try Task.checkCancellation()
            try await engine.load(id: model.id, folder: models.folder(model.id))
            progressFraction = TranscriptionAudio.progress(recording: record, nextChunks: job.nextChunks)
            for source in TranscriptSource.allCases {
                guard let track = source == .microphone ? record.microphone : record.systemAudio else { continue }
                guard track.duration.isFinite, track.duration >= 0, track.startOffset.isFinite else { throw CocoaError(.fileReadCorruptFile) }
                let count = Int(ceil(track.duration / TranscriptionAudio.chunkSeconds))
                var chunk = job.nextChunks[source] ?? 0
                while chunk < count {
                    try Task.checkCancellation()
                    guard !suspended, canRun?() == true else { throw CancellationError() }
                    guard let (_, folder) = recording?(job.recordingID) else { throw CocoaError(.fileNoSuchFile) }
                    progress = "Transcribing…"
                    let currentChunk = chunk
                    let samples = try await Task.detached(priority: .utility) {
                        try TranscriptionAudio.read(url: folder.appendingPathComponent(track.file), chunk: currentChunk)
                    }.valueWithCancellation()
                    let began = ProcessInfo.processInfo.systemUptime
                    if samples.count >= 1600, !TranscriptionAudio.isSilent(samples) {
                        let segments = try await engine.transcribe(samples)
                        try Task.checkCancellation()
                        job.segments += segments.compactMap {
                            TranscriptionAudio.aligned(text: $0.text, source: source, start: $0.start, end: $0.end, chunk: chunk, track: track)
                        }
                    }
                    job.processingSeconds += ProcessInfo.processInfo.systemUptime - began
                    chunk += 1; job.nextChunks[source] = chunk
                    try checkpoint(job)
                    progressFraction = TranscriptionAudio.progress(recording: record, nextChunks: job.nextChunks)
                }
            }
            try Task.checkCancellation()
            progress = "Finishing…"
            guard let (_, folder) = recording?(job.recordingID) else { throw CocoaError(.fileNoSuchFile) }
            var result = Transcript(recordingID: job.recordingID, modelID: model.id, modelName: model.name,
                                    revision: model.revision, processingSeconds: job.processingSeconds, segments: job.segments)
            result.id = job.resultID
            let completed = result
            try await Task.detached(priority: .utility) { try TranscriptFiles.save(completed, folder: folder) }.valueWithCancellation()
            jobs.removeAll { $0.id == job.id }; persist(); resultsVersion += 1
            transcriptCompleted?(completed)
            if notifyWhenReady { didComplete?(job.recordingID) }
        } catch is CancellationError {
            // Last completed chunk is durable. Resume it after capture or next launch.
        } catch {
            guard !Task.isCancelled else { return }
            job.state = .failed; job.error = error.localizedDescription
            do { try checkpoint(job) }
            catch {
                if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index] = job }
                self.error = "Couldn’t save transcription progress: \(error.localizedDescription)"
            }
        }
    }
}
