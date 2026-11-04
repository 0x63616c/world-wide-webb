import SwiftUI
import CallkeepCore

struct TranscriptionSettingsView: View {
    @Bindable var controller: TranscriptionController
    let notifications: TranscriptionNotifications
    @State private var showingCredits = false
    @State private var removingModel: TranscriptionModel?
    @State private var hoveredModelID: String?
    var body: some View {
        VStack(spacing: 0) {
            SettingsSwitchRow("Transcribe after recording", isOn: $controller.automatic)
                .disabled(!TranscriptionModel.supported)
            SettingsDivider()
            SettingsSwitchRow("Notify when a transcript is ready", isOn: $controller.notifyWhenReady)
                .onChange(of: controller.notifyWhenReady) { _, value in if value { notifications.requestIfNeeded() } }
            SettingsDivider()
            SettingsRow {
                Text("Default model")
                Spacer()
                Picker("Default model", selection: $controller.selectedModelID) {
                    ForEach(TranscriptionModel.all) { Text($0.name).tag($0.id) }
                }.labelsHidden().fixedSize()
            }
            ForEach(TranscriptionModel.all) { model in
                SettingsDivider()
                SettingsRow(minHeight: 60) {
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
                        SettingsHoverAction(title: "Remove \(model.name)", symbol: "trash", hovering: hoveredModelID == model.id) {
                            removingModel = model
                        }.disabled(controller.runningModelID == model.id)
                    } else {
                        Button("Download") { controller.models.download(model.id) }
                            .disabled(controller.models.downloading != nil || !TranscriptionModel.supported)
                    }
                }.contentShape(Rectangle())
                    .onHover { hovering in
                        if hovering { hoveredModelID = model.id }
                        else if hoveredModelID == model.id { hoveredModelID = nil }
                    }
            }
            HStack {
                Text("All audio is processed locally").font(.caption).foregroundStyle(.secondary)
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
                Spacer()
                if let selected {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(selected.plainText, forType: .string)
                    } label: { Image(systemName: "doc.on.doc").frame(width: 24, height: 24) }
                        .buttonStyle(.borderless).foregroundStyle(.secondary)
                        .help("Copy transcript").accessibilityLabel("Copy transcript")
                }
                if results.isEmpty, controller.status(for: recording.id) == nil {
                    Button("Transcribe") { controller.enqueue(recording) }
                        .disabled(model.isRecording || !TranscriptionModel.supported)
                }
                Menu {
                    if let selected {
                        Button("Transcribe again") { controller.enqueue(recording, modelID: selected.modelID) }
                        Divider()
                    }
                    Section("Transcribe with") {
                        ForEach(TranscriptionModel.all) { choice in
                            Button(choice.name + (controller.models.installed.contains(choice.id) ? "" : " (download required)")) {
                                controller.enqueue(recording, modelID: choice.id)
                            }
                        }
                    }
                } label: { Image(systemName: "ellipsis").frame(width: 24, height: 24) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .help("Transcript actions").accessibilityLabel("Transcript actions")
                    .disabled(model.isRecording || !TranscriptionModel.supported)
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
                                LazyVStack(alignment: .leading, spacing: 4) {
                                    ForEach(selected.segments) { segment in
                                        let active = segment.id == currentID
                                        Button { model.playback.seek(segment.start) } label: {
                                            VStack(alignment: .leading, spacing: 6) {
                                                HStack(spacing: 12) {
                                                    Text(segment.source.label).font(.caption.weight(.semibold))
                                                        .foregroundStyle(segment.source == .microphone ? VoiceColor.microphone : VoiceColor.systemAudio)
                                                    Text(Recording.timeString(segment.start))
                                                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                                }
                                                Text(segment.text).font(.system(size: 16))
                                                    .lineSpacing(4).frame(maxWidth: .infinity, alignment: .leading)
                                            }.padding(.horizontal, 12).padding(.vertical, 14)
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
                HStack {
                    if results.count > 1 {
                        Menu {
                            ForEach(results) { result in
                                Button { resultID = result.id } label: {
                                    if result.id == selected.id {
                                        Label("\(result.modelName) · \(result.createdAt.formatted(date: .omitted, time: .shortened))", systemImage: "checkmark")
                                    } else {
                                        Text("\(result.modelName) · \(result.createdAt.formatted(date: .omitted, time: .shortened))")
                                    }
                                }
                            }
                        } label: { Text(selected.modelName) }
                            .menuStyle(.borderlessButton).fixedSize()
                            .accessibilityLabel("Transcript version")
                    } else { Text(selected.modelName) }
                    Spacer()
                    TimelineView(.animation(minimumInterval: 0.2, paused: !model.playback.isPlaying)) { _ in
                        Text(Recording.timeString(model.playback.currentPosition)).monospacedDigit()
                    }
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12)
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
