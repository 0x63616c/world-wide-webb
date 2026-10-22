import SwiftUI
import AVFoundation
import CallkeepCore

struct LibraryView: View {
    @Bindable var model: AppModel
    @State private var deleting = false
    var body: some View {
        NavigationSplitView {
            List(selection: Binding(get: { model.selectedIDs }, set: { model.selectMany($0) })) {
                ForEach(model.filtered) { recording in
                    RecordingRow(recording: recording, live: model.active?.id == recording.id)
                        .tag(recording.id)
                        .contextMenu {
                            Button("Show in Finder") { model.reveal(recording) }
                            Divider()
                            Button("Move to Trash…", role: .destructive) {
                                if !model.selectedIDs.contains(recording.id) { model.selectMany([recording.id]) }
                                deleting = true
                            }.disabled(recording.id == model.active?.id)
                        }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Callkeep")
            .navigationSplitViewColumnWidth(min: 235, ideal: 270, max: 360)
            .onDeleteCommand { if model.canTrashSelection { deleting = true } }
            .onCommand(#selector(NSResponder.selectAll(_:))) { model.selectMany(Set(model.filtered.map(\.id))) }
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Text("\(model.recordings.count) recordings").font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    SettingsLink { Image(systemName: "gearshape") }.buttonStyle(.plain).help("Settings")
                }.padding(16)
            }
        } detail: {
            VStack(spacing: 0) {
                if let error = model.errorMessage { ErrorBanner(text: error) { model.errorMessage = nil }.padding([.horizontal, .top], 22) }
                if model.selectedIDs.count > 1 {
                    VStack(spacing: 20) {
                        Image(systemName: "waveform").font(.system(size: 40, weight: .light)).foregroundStyle(.tertiary)
                        Text("\(model.selectedIDs.count) Recordings").font(.title2.weight(.medium))
                        Button("Move to Trash…", role: .destructive) { deleting = true }.disabled(!model.canTrashSelection)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.isRecording, model.selectedID == model.active?.id { LiveRecordingView(model: model) }
                else if let recording = model.selected { RecordingDetail(model: model, recording: recording).id(recording.id) }
                else { EmptyLibraryView(model: model) }
            }
            .background(Color(nsColor: .textBackgroundColor))
            .navigationTitle(model.isRecording ? "Recording" : "Callkeep")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { deleting = true } label: { Image(systemName: "trash") }
                        .disabled(!model.canTrashSelection).help("Move selected recordings to Trash")
                        .keyboardShortcut(.delete, modifiers: .command)
                    RecordButton(model: model)
                }
            }
        }
        .searchable(text: $model.search, placement: .sidebar, prompt: "Search")
        .onChange(of: model.isRecording) { _, active in if !active, model.selectedIDs.count == 1 { model.select(model.selectedID) } }
        .onAppear { if !model.isRecording, model.selectedIDs.count == 1 { model.select(model.selectedID) } }
        .confirmationDialog(model.selectedIDs.count == 1 ? "Move recording to Trash?" : "Move \(model.selectedIDs.count) recordings to Trash?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Move to Trash", role: .destructive) { model.trashSelection() }
        }
    }
}

struct RecordingRow: View {
    let recording: Recording
    let live: Bool
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: live ? "record.circle.fill" : "waveform")
                .font(.system(size: 17, weight: .medium)).foregroundStyle(live ? .red : .secondary)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 5) {
                Text(recording.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
                HStack(spacing: 6) {
                    Text(recording.createdAt, format: .dateTime.month(.abbreviated).day())
                    Spacer()
                    if recording.state == .interrupted { Image(systemName: "exclamationmark.circle") }
                    Text(live ? "Recording" : recording.formattedDuration).monospacedDigit()
                }.font(.caption).foregroundStyle(live ? .red : .secondary)
            }
        }.padding(.vertical, 8).accessibilityElement(children: .combine)
    }
}

struct EmptyLibraryView: View {
    @Bindable var model: AppModel
    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "waveform").font(.system(size: 44, weight: .light)).foregroundStyle(.tertiary)
            Text(model.recordings.isEmpty ? "No Recordings" : "Select a Recording").font(.title2.weight(.medium))
            if model.recordings.isEmpty { RecordButton(model: model).controlSize(.large) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct LiveRecordingView: View {
    @Bindable var model: AppModel
    var body: some View {
        VStack(spacing: 38) {
            HStack(spacing: 8) { Circle().fill(.red).frame(width: 7, height: 7); Text("Recording").font(.callout).foregroundStyle(.secondary) }
            Text(Recording.timeString(model.elapsed)).font(.system(size: 64, weight: .light)).monospacedDigit()
            WaveformView(peaks: model.levelHistory, progress: 1, live: true).frame(height: 90).padding(.horizontal, 30)
            RecordButton(model: model).controlSize(.large)
        }.padding(40).frame(maxWidth: 650, maxHeight: .infinity)
    }
}

struct RecordingDetail: View {
    @Bindable var model: AppModel
    let recording: Recording
    @State private var peaks: [Float] = []
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var showingInfo = false
    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(recording.title).font(.system(size: 27, weight: .semibold)).textSelection(.enabled)
                    Text(recording.createdAt, format: .dateTime.month(.wide).day().year().hour().minute()).font(.callout).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Menu {
                    Button("Rename…") { newTitle = recording.title; renaming = true }
                    Button("Show in Finder") { model.reveal(recording) }
                    Button("Recording Info") { showingInfo = true }
                } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).fixedSize().help("Recording actions")
            }
            Spacer(minLength: 12)
            WaveformView(peaks: peaks, progress: model.playback.duration > 0 ? model.playback.position / model.playback.duration : 0).frame(height: 120)
            VStack(spacing: 8) {
                Slider(value: Binding(get: { model.playback.position }, set: { model.playback.seek($0) }), in: 0...max(model.playback.duration, 0.01)).accessibilityLabel("Playback position")
                HStack { Text(Recording.timeString(model.playback.position)); Spacer(); Text(recording.formattedDuration) }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }.disabled(model.isRecording || recording.duration == 0)
            HStack(spacing: 30) {
                Spacer()
                Button { model.playback.seek(model.playback.position - 10) } label: { Image(systemName: "gobackward.10").font(.title2) }.buttonStyle(.plain).help("Back 10 seconds")
                Button { model.playback.toggle() } label: {
                    Image(systemName: model.playback.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 24, weight: .medium)).frame(width: 64, height: 64).background(.quaternary, in: Circle())
                }.buttonStyle(.plain).accessibilityLabel(model.playback.isPlaying ? "Pause" : "Play recording")
                Button { model.playback.seek(model.playback.position + 10) } label: { Image(systemName: "goforward.10").font(.title2) }.buttonStyle(.plain).help("Forward 10 seconds")
                Spacer()
            }.disabled(model.isRecording || recording.duration == 0)
            Spacer(minLength: 12)
            if let note = recording.note { Label(note, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(.secondary) }
        }.padding(40).frame(maxWidth: 850, maxHeight: .infinity)
        .task(id: recording.id) {
            guard let store = model.store else { return }
            peaks = await Self.readPeaks(recording, folder: store.folder(for: recording))
        }
        .sheet(isPresented: $renaming) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Rename Recording").font(.title2.weight(.semibold))
                TextField("Name", text: $newTitle).textFieldStyle(.roundedBorder).onSubmit { saveTitle() }
                HStack { Spacer(); Button("Cancel", role: .cancel) { renaming = false }; Button("Save") { saveTitle() }.keyboardShortcut(.defaultAction).disabled(newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }.padding(24).frame(width: 380)
        }
        .sheet(isPresented: $showingInfo) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Recording Info").font(.title2.weight(.semibold))
                LabeledContent("Duration", value: recording.formattedDuration)
                LabeledContent("Created", value: recording.createdAt.formatted())
                LabeledContent("Format", value: "Lossless PCM")
                Button("Show Files in Finder") { model.reveal(recording) }
                HStack { Spacer(); Button("Done") { showingInfo = false }.keyboardShortcut(.defaultAction) }
            }.padding(28).frame(width: 380)
        }
    }
    private func saveTitle() { model.rename(recording, to: newTitle); renaming = false }
    nonisolated static func readPeaks(_ recording: Recording, folder: URL) async -> [Float] {
        await Task.detached(priority: .utility) {
            var result = Array(repeating: Float(0), count: 160)
            for track in [recording.microphone, recording.systemAudio].compactMap({ $0 }) {
                guard let file = try? AVAudioFile(forReading: folder.appendingPathComponent(track.file)), file.length > 0,
                      let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1024) else { continue }
                for bin in 0..<160 {
                    let time = recording.duration * Double(bin) / 160 - track.startOffset
                    guard time >= 0 && time < track.duration else { continue }
                    file.framePosition = min(file.length - 1, AVAudioFramePosition(time * file.processingFormat.sampleRate))
                    try? file.read(into: buffer, frameCount: 1024)
                    if let data = buffer.floatChannelData {
                        for i in 0..<Int(buffer.frameLength) { result[bin] = max(result[bin], abs(data[0][i])) }
                    }
                }
            }
            return result
        }.value
    }

}

struct WaveformView: View {
    let peaks: [Float]
    let progress: Double
    var live = false
    var body: some View {
        Canvas { context, size in
            let values = peaks.isEmpty ? Array(repeating: Float(0), count: 160) : peaks
            let maximum = live ? 1 : max(values.max() ?? 0, 0.01)
            let spacing = size.width / Double(values.count)
            for (index, peak) in values.enumerated() {
                let height = max(3, Double(sqrt(min(peak / maximum, 1))) * size.height)
                let rect = CGRect(x: Double(index) * spacing, y: (size.height - height) / 2, width: max(1, spacing - 2), height: height)
                context.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(Double(index) / Double(values.count) <= progress ? (live ? .red : .accentColor) : .secondary.opacity(0.3)))
            }
        }.accessibilityLabel(live ? "Live audio level" : "Recorded audio waveform")
    }
}
