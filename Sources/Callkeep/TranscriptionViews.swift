import SwiftUI
import CallkeepCore

struct TranscriptionSettingsView: View {
    @Bindable var controller: TranscriptionController
    let notifications: TranscriptionNotifications
    @State private var showingCredits = false
    @State private var removingModel: TranscriptionModel?
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Toggle("Transcribe after recording", isOn: $controller.automatic)
                Spacer()
            }.frame(minHeight: 54).padding(.horizontal, 16)
                .disabled(!TranscriptionModel.supported)
            Divider().padding(.leading, 16)
            Toggle("Notify when a transcript is ready", isOn: $controller.notifyWhenReady)
                .onChange(of: controller.notifyWhenReady) { _, value in if value { notifications.requestIfNeeded() } }
                .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading).padding(.horizontal, 16)
            if notifications.denied {
                Text("Allow Callkeep notifications in System Settings to receive transcript alerts.")
                    .font(.caption).foregroundStyle(.secondary).padding([.horizontal, .bottom], 16)
            }
            Divider().padding(.leading, 16)
            HStack {
                Text("Default model")
                Spacer()
                Picker("Default model", selection: $controller.selectedModelID) {
                    ForEach(TranscriptionModel.all) { Text($0.name).tag($0.id) }
                }.labelsHidden().fixedSize()
            }.frame(minHeight: 54).padding(.horizontal, 16)
            ForEach(TranscriptionModel.all) { model in
                Divider().padding(.leading, 16)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.name)
                        Text(model.detail).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if controller.models.downloading == model.id {
                        VStack(alignment: .trailing, spacing: 5) {
                            ProgressView(value: controller.models.progress).frame(width: 110)
                            HStack(spacing: 8) {
                                Text(controller.models.progress, format: .percent.precision(.fractionLength(0)))
                                if controller.models.bytesPerSecond > 0 {
                                    Text(ByteCountFormatter.string(fromByteCount: Int64(controller.models.bytesPerSecond), countStyle: .file) + "/s")
                                }
                            }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        Button("Cancel") { controller.models.cancelDownload() }
                    } else if controller.models.installed.contains(model.id) {
                        Button("Remove") { removingModel = model }
                            .disabled(controller.runningModelID == model.id)
                    } else {
                        Button("Download") { controller.models.download(model.id) }
                            .disabled(controller.models.downloading != nil || !TranscriptionModel.supported)
                    }
                }.frame(minHeight: 60).padding(.horizontal, 16)
            }
            HStack {
                Text("Processed on this Mac. No audio is sent to a transcription service.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Credits") { showingCredits = true }.buttonStyle(.link).font(.caption)
            }.padding(16)
            if !TranscriptionModel.supported {
                Text("Local transcription requires Apple silicon.").font(.callout).foregroundStyle(.secondary).padding([.horizontal, .bottom], 16)
            }
            if let error = controller.models.error ?? controller.error {
                Text(error).font(.callout).foregroundStyle(.orange).textSelection(.enabled).padding([.horizontal, .bottom], 16)
            }
        }
        .confirmationDialog(removingModel.map { "Remove \($0.name)?" } ?? "Remove model?",
                            isPresented: Binding(get: { removingModel != nil }, set: { if !$0 { removingModel = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                if let model = removingModel, controller.runningModelID != model.id { controller.models.remove(model.id) }
                removingModel = nil
            }
            Button("Cancel", role: .cancel) { removingModel = nil }
        } message: {
            Text("You’ll need to download it again to use this model.")
        }
        .sheet(isPresented: $showingCredits) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Transcription credits").font(.title2.weight(.semibold))
                ScrollView {
                    Text((Bundle.main.url(forResource: "Transcription-LICENSES", withExtension: "txt").flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? "Credits unavailable")
                        .font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack { Spacer(); Button("Done") { showingCredits = false }.keyboardShortcut(.defaultAction) }
            }.padding(24).frame(width: 560, height: 480)
        }
    }
}

struct TranscriptView: View {
    @Bindable var model: AppModel
    let recording: Recording
    @State private var results: [Transcript] = []
    @State private var resultID: UUID?
    @State private var readError: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var controller: TranscriptionController { model.transcription }
    private var selected: Transcript? { results.first { $0.id == resultID } ?? results.first }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text("Transcript").font(.headline)
                if results.count > 1 {
                    Picker("Transcript", selection: Binding(get: { selected?.id ?? UUID() }, set: { resultID = $0 })) {
                        ForEach(results) { result in
                            Text("\(result.modelName) · \(result.createdAt.formatted(date: .omitted, time: .shortened))").tag(result.id)
                        }
                    }.labelsHidden().frame(maxWidth: 290)
                } else if let selected {
                    Text(selected.modelName).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                if let selected {
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(selected.plainText, forType: .string)
                    }
                }
                if results.isEmpty, controller.status(for: recording.id) == nil {
                    Button("Transcribe") { controller.enqueue(recording) }
                        .disabled(model.isRecording || !TranscriptionModel.supported)
                }
                Menu("Transcribe with…") {
                    ForEach(TranscriptionModel.all) { choice in
                        Button(choice.name + (controller.models.installed.contains(choice.id) ? "" : " (download required)")) {
                            controller.enqueue(recording, modelID: choice.id)
                        }
                    }
                }.disabled(model.isRecording || !TranscriptionModel.supported)
            }
            if let status = controller.status(for: recording.id) {
                HStack(alignment: .top) {
                    if controller.runningID == recording.id { ProgressView().controlSize(.small) }
                    Text(status).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                    Spacer()
                    if controller.jobs.contains(where: { $0.recordingID == recording.id && $0.state == .failed }) {
                        Button("Retry") { controller.retry(recording.id) }
                    }
                    if controller.jobs.contains(where: { $0.recordingID == recording.id && !controller.models.installed.contains($0.modelID) }) {
                        Button("Models…") { model.showSettings() }
                    }
                    Button("Cancel") { controller.cancel(recording.id) }
                }
            }
            if let readError = readError ?? controller.error { Text(readError).font(.callout).foregroundStyle(.orange) }
            if let selected {
                if selected.segments.isEmpty {
                    ContentUnavailableView("No speech found", systemImage: "text.bubble", description: Text("The selected model didn’t detect speech in this recording."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                } else {
                    TimelineView(.animation(minimumInterval: 0.2, paused: !model.playback.isPlaying)) { _ in
                        let position = model.playback.currentPosition
                        let currentID = selected.segments.last { $0.start <= position && position < $0.end }?.id
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 12) {
                                    ForEach(selected.segments) { segment in
                                        let active = segment.start <= position && position < segment.end
                                        Button { model.playback.seek(segment.start) } label: {
                                            HStack(alignment: .top, spacing: 16) {
                                                Text(Recording.timeString(segment.start))
                                                    .font(.caption.monospacedDigit())
                                                    .foregroundStyle(active ? Color.accentColor : Color.secondary)
                                                    .frame(width: 48, alignment: .leading).padding(.top, 2)
                                                VStack(alignment: .leading, spacing: 5) {
                                                    Text(segment.source.label).font(.caption.weight(.semibold))
                                                        .foregroundStyle(segment.source == .microphone ? VoiceColor.microphone : VoiceColor.systemAudio)
                                                    Text(segment.text).frame(maxWidth: .infinity, alignment: .leading)
                                                }
                                            }.padding(8)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                                .background(active ? Color.accentColor.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: 8))
                                                .contentShape(Rectangle())
                                        }.buttonStyle(.plain)
                                            .help("Seek to \(Recording.timeString(segment.start))")
                                            .accessibilityLabel("\(segment.source.label), \(Recording.timeString(segment.start)): \(segment.text)")
                                            .id(segment.id)
                                    }
                                }.padding(.vertical, 4)
                            }
                            .onChange(of: currentID) { _, id in
                                guard let id else { return }
                                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
                            }
                        }
                    }
                }
                Text("\(selected.modelName) · \(selected.processingSeconds.formatted(.number.precision(.fractionLength(1))))s processing")
                    .font(.caption).foregroundStyle(.tertiary)
            } else if controller.status(for: recording.id) == nil {
                ContentUnavailableView("No transcript yet", systemImage: "text.bubble", description: Text("Choose a model to transcribe this recording locally."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else { Spacer(minLength: 0) }
        }
        .task(id: "\(recording.id)-\(controller.resultsVersion)-\(model.store?.folder(for: recording).path ?? "")") {
            guard let folder = model.store?.folder(for: recording) else { return }
            do {
                let loaded = try await Task.detached(priority: .utility) { try TranscriptFiles.load(folder: folder) }.valueWithCancellation()
                guard !Task.isCancelled else { return }
                results = loaded; readError = nil
            } catch is CancellationError { }
            catch { readError = "Couldn’t load transcripts: \(error.localizedDescription)" }
        }
    }
}
