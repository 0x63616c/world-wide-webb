import AppKit
import AVFoundation
import Observation
import CallkeepCore

@MainActor @Observable
final class AppModel {
    var recordings: [Recording] = []
    var selectedIDs: Set<UUID> = []
    var showingSettings = false
    var presentLibrary: (() -> Void)?
    var selectedID: UUID? {
        get { selectedIDs.count == 1 ? selectedIDs.first : nil }
        set { selectedIDs = newValue.map { [$0] } ?? [] }
    }
    let permissions = Permissions()
    var levelHistory: [Float] = Array(repeating: 0, count: 120)
    var active: Recording?
    var isBusy = false
    var elapsed: TimeInterval = 0
    var micLevel: Float = 0
    var systemLevel: Float = 0
    var errorMessage: String?
    var statusMessage: String?
    var shortcutError: String?
    var search = ""
    var recordingShortcut = (UserDefaults.standard.data(forKey: "recordingShortcut").flatMap { try? JSONDecoder().decode(Shortcut.self, from: $0) }) ?? .default
    let playback = Playback()
    private(set) var store: RecordingStore?
    private let capture = AudioCapture()
    private let shortcut = GlobalShortcut()
    private var timer: Timer?
    private var epoch: TimeInterval = 0
    private var checkpoint: TimeInterval = 0
    var isRecording: Bool { active != nil }
    var selected: Recording? { recordings.first { $0.id == selectedID } }
    var filtered: [Recording] { recordings.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) } }
    var shortcutLabel: String { recordingShortcut.label }
    init() {
        do {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            store = try RecordingStore(root: base.appendingPathComponent("Callkeep/Recordings", isDirectory: true))
            try reload(recover: true)
            selectedID = recordings.first?.id
        } catch { errorMessage = "Couldn’t open the recording library: \(error.localizedDescription)" }
        shortcut.action = { [weak self] in self?.toggleRecording() }
        updateShortcut()
    }
    func suspendShortcut(_ suspended: Bool) {
        _ = shortcut.register(shortcut: recordingShortcut, enabled: !suspended)
    }
    func updateShortcut() {
        UserDefaults.standard.set(try? JSONEncoder().encode(recordingShortcut), forKey: "recordingShortcut")
        shortcutError = shortcut.register(shortcut: recordingShortcut, enabled: true) ? nil : "That shortcut is already in use. Choose another key."
    }
    func reload(recover: Bool = false) throws {
        recordings = try store?.load(recover: recover) ?? []
        if let warning = store?.warnings.first { errorMessage = warning }
    }
    func toggleRecording() {
        guard !isBusy else { return }
        if isRecording { stopRecording() } else { Task { await startRecording() } }
    }
    func startRecording() async {
        guard !isRecording, !isBusy, let store else { return }
        isBusy = true; defer { isBusy = false }
        errorMessage = nil; statusMessage = nil
        playback.stop()
        permissions.refresh()
        guard permissions.canRecord else { showSettings(); return }
        showingSettings = false
        do {
            try checkDisk()
            let next = (recordings.compactMap { record -> Int? in
                guard record.title.hasPrefix("Recording ") else { return nil }
                return Int(record.title.dropFirst(10))
            }.max() ?? 0) + 1
            let recording = Recording(title: "Recording \(next)")
            try store.save(recording)
            epoch = ProcessInfo.processInfo.systemUptime
            levelHistory = Array(repeating: 0, count: 120)
            do { try capture.start(folder: store.folder(for: recording), epoch: epoch) }
            catch {
                var interrupted = recording; interrupted.state = .interrupted; interrupted.note = error.localizedDescription
                interrupted.microphone = RecordingStore.inspect(store.folder(for: recording).appendingPathComponent("microphone.caf"), offset: 0)
                interrupted.systemAudio = RecordingStore.inspect(store.folder(for: recording).appendingPathComponent("system-audio.caf"), offset: 0)
                interrupted.duration = max(interrupted.microphone?.duration ?? 0, interrupted.systemAudio?.duration ?? 0)
                try store.save(interrupted); try reload(); selectedID = interrupted.id
                throw error
            }
            active = recording; elapsed = 0; checkpoint = 0; selectedID = recording.id
            try reload(); statusMessage = "Recording started"
            StatusToast.shared.show("Recording started", recording: true)
            timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
            if let timer { RunLoop.main.add(timer, forMode: .common) }
        } catch {
            errorMessage = error.localizedDescription
            if active != nil { stopRecording(reason: error.localizedDescription) }
        }
    }
    private func tick() {
        guard var active else { return }
        elapsed = ProcessInfo.processInfo.systemUptime - epoch
        let mic = capture.microphone?.snapshot; let system = capture.system?.snapshot
        micLevel = mic?.level ?? 0; systemLevel = system?.level ?? 0
        levelHistory.append(max(micLevel, systemLevel)); levelHistory.removeFirst()
        if elapsed > 2 && !capture.microphoneRunning { stopRecording(reason: "Microphone disconnected. Your recording was saved."); return }
        if let error = mic?.error ?? system?.error { stopRecording(reason: error); return }
        if elapsed - checkpoint >= 5 {
            checkpoint = elapsed
            if AudioCapture.currentDeviceIDs != capture.deviceIDs {
                stopRecording(reason: "The audio device changed. Your audio was saved; start a new recording with the new device."); return
            }
            do {
                try checkDisk()
                active.duration = elapsed
                active.microphone = capture.microphone?.track; active.systemAudio = capture.system?.track
                try store?.save(active)
            } catch { stopRecording(reason: error.localizedDescription) }
        }
    }
    func stopRecording(reason: String? = nil) {
        guard var recording = active else { return }
        isBusy = true; timer?.invalidate(); timer = nil
        let tracks = capture.stop()
        recording.microphone = tracks.microphone; recording.systemAudio = tracks.system
        recording.duration = max(tracks.microphone.map { $0.startOffset + $0.duration } ?? 0, tracks.system.map { $0.startOffset + $0.duration } ?? 0)
        recording.state = reason == nil && tracks.microphone != nil && tracks.system != nil ? .saved : .interrupted
        recording.note = reason ?? ((tracks.microphone == nil || tracks.system == nil) ? "One audio source didn’t deliver samples. Check permissions and audio devices before the next recording." : nil)
        active = nil; micLevel = 0; systemLevel = 0
        do { try store?.save(recording); try reload(); statusMessage = "Recording saved"; StatusToast.shared.show("Recording saved", recording: false) }
        catch { errorMessage = "Audio was kept, but the library couldn’t be updated: \(error.localizedDescription)" }
        if let reason { errorMessage = reason }
        isBusy = false
    }
    func select(_ id: UUID?) {
        showingSettings = false
        playback.stop(); selectedID = id
        guard let recording = selected, recording.id != active?.id, let store else { return }
        do { try playback.load(recording, folder: store.folder(for: recording)) }
        catch { errorMessage = "Couldn’t play this recording: \(error.localizedDescription)" }
    }
    func rename(_ recording: Recording, to title: String) {
        guard let store, recording.id != active?.id,
              var updated = recordings.first(where: { $0.id == recording.id }) else { return }
        updated.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !updated.title.isEmpty else { return }
        do { try store.save(updated); try reload() } catch { errorMessage = error.localizedDescription }
    }
    var selectedRecordings: [Recording] { recordings.filter { selectedIDs.contains($0.id) } }
    var canTrashSelection: Bool { !selectedIDs.isEmpty && !selectedIDs.contains(active?.id ?? UUID()) }
    func selectMany(_ ids: Set<UUID>) {
        guard ids != selectedIDs || showingSettings else { return }
        // List may clear its selection while Settings takes focus.
        if !ids.isEmpty { showingSettings = false }
        playback.stop(); selectedIDs = ids
        if ids.count == 1 { select(ids.first) }
    }
    func showSettings() {
        playback.stop(); selectedIDs = []; showingSettings = true
        permissions.refresh(); presentLibrary?()
    }
    func showRecordings() {
        showingSettings = false
        if selectedIDs.isEmpty { select(active?.id ?? recordings.first?.id) }
        presentLibrary?()
    }
    func trashSelection() {
        guard canTrashSelection, let store else { return }
        let targets = selectedRecordings
        playback.stop()
        var errors: [String] = []
        for recording in targets {
            do { try FileManager.default.trashItem(at: store.folder(for: recording), resultingItemURL: nil) }
            catch { errors.append("\(recording.title): \(error.localizedDescription)") }
        }
        do { try reload(); selectedIDs = selectedIDs.intersection(Set(recordings.map(\.id))) }
        catch { errors.append(error.localizedDescription) }
        if !errors.isEmpty { errorMessage = errors.joined(separator: "\n") }
    }
    func reveal(_ recording: Recording) {
        guard let store else { return }; NSWorkspace.shared.activateFileViewerSelecting([store.folder(for: recording)])
    }
    private func checkDisk() throws {
        guard let store else { return }
        let values = try store.root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        if let bytes = values.volumeAvailableCapacityForImportantUsage, bytes < 250_000_000 { throw CaptureError(message: "Less than 250 MB of disk space remains. Free some space before recording again.") }
    }
}
