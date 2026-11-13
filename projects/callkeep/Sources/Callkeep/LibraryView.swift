import AVFoundation
import CallkeepCore
import SwiftUI

struct LibraryView: View {
  @Bindable var model: AppModel
  @Environment(\.openWindow) private var openWindow
  @State private var deleting = false
  @State private var renamingID: UUID?
  @State private var showingInfo: Recording?
  @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
  var body: some View {
    NavigationSplitView(columnVisibility: $columnVisibility) {
      List(selection: Binding(get: { model.selectedIDs }, set: { model.selectMany($0) })) {
        Section {
          ForEach(model.filtered) { recording in
            RecordingRow(recording: recording, live: model.active?.id == recording.id)
              .tag(recording.id)
              .contextMenu {
                Button("Rename") {
                  if model.selectedID != recording.id { model.select(recording.id) }
                  renamingID = recording.id
                }
                Button("Show in Finder") { model.reveal(recording) }
                Divider()
                Button("Move to Trash…", role: .destructive) {
                  if !model.selectedIDs.contains(recording.id) { model.selectMany([recording.id]) }
                  deleting = true
                }.disabled(
                  recording.id == model.active?.id || recording.id == model.transcription.runningID)
              }
          }
        } header: {
          Color.clear.frame(height: 8).accessibilityHidden(true)
        }
      }
      .listStyle(.sidebar)
      .navigationTitle(AppIdentity.title)
      .navigationSplitViewColumnWidth(min: 235, ideal: 270, max: 360)
      .onDeleteCommand { if model.canTrashSelection { deleting = true } }
      .onKeyPress(.return) {
        guard let recording = model.selected, !model.showingSettings else { return .ignored }
        renamingID = recording.id
        return .handled
      }
      .onCommand(#selector(NSResponder.selectAll(_:))) {
        model.selectMany(Set(model.filtered.map(\.id)))
      }
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 8) {
          Divider()
          HStack(spacing: 8) {
            Button {
              model.showSettings()
            } label: {
              HStack(spacing: 10) {
                Image(systemName: "gearshape").frame(width: 22)
                Text("Settings")
                Spacer()
                Text(AppIdentity.version).font(.caption).foregroundStyle(.secondary)
              }.padding(.horizontal, 10).padding(.vertical, 9).contentShape(Rectangle())
                .background(
                  model.showingSettings ? Color.primary.opacity(0.09) : .clear,
                  in: RoundedRectangle(cornerRadius: 7))
            }.buttonStyle(.plain)
          }
        }.padding(.horizontal, 12).padding(.bottom, 12)
      }
    } detail: {
      VStack(spacing: 0) {
        if let error = model.errorMessage {
          ErrorBanner(text: error) { model.errorMessage = nil }.padding([.horizontal, .top], 22)
        }
        if model.showingSettings {
          SettingsView(model: model)
        } else if model.selectedIDs.count > 1 {
          VStack(spacing: 20) {
            Image(systemName: "waveform").font(.system(size: 40, weight: .light)).foregroundStyle(
              .tertiary)
            Text("\(model.selectedIDs.count) Recordings").font(.title2.weight(.medium))
            Button("Move to Trash…", role: .destructive) { deleting = true }.disabled(
              !model.canTrashSelection)
          }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.isRecording, model.selectedID == model.active?.id {
          LiveRecordingView(model: model, renamingID: $renamingID)
        } else if let recording = model.selected {
          RecordingDetail(model: model, recording: recording, renamingID: $renamingID).id(
            recording.id)
        } else {
          EmptyLibraryView(model: model)
        }
      }
      .frame(minWidth: 500, maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(nsColor: .textBackgroundColor))
      .navigationTitle(AppIdentity.title)
      .toolbar {
        ToolbarItemGroup(placement: .primaryAction) {
          if !model.showingSettings {
            Menu {
              if let recording = model.selected {
                Button("Rename") { renamingID = recording.id }
                Button("Show in Finder") { model.reveal(recording) }
                Button("Recording Info") { showingInfo = recording }
                Divider()
              }
              Button("Move to Trash…", role: .destructive) { deleting = true }
                .disabled(!model.canTrashSelection).keyboardShortcut(.delete, modifiers: .command)
            } label: {
              Label("Recording actions", systemImage: "ellipsis")
            }
            .menuIndicator(.hidden).disabled(model.selectedIDs.isEmpty).help("Recording actions")
          }
          RecordButton(model: model)
        }
      }
    }
    .searchable(text: $model.search, placement: .sidebar, prompt: "Search")
    .onChange(of: model.search) {
      if !model.search.isEmpty { model.showingSettings = false }
      if !model.showingSettings {
        let visible = Set(model.filtered.map(\.id))
        if !model.selectedIDs.isSubset(of: visible) {
          model.selectMany(model.selectedIDs.intersection(visible))
        }
      }
    }
    .onChange(of: model.isRecording) { _, active in
      if !active, model.selectedIDs.count == 1 { model.select(model.selectedID) }
    }
    .onAppear {
      model.presentLibrary = {
        NSApp.setActivationPolicy(.regular)
        openWindow(id: "library")
        NSApp.activate(ignoringOtherApps: true)
      }
      if !model.isRecording, model.selectedIDs.count == 1 { model.select(model.selectedID) }
      #if DEBUG
        if let scene = Bundle.main.object(forInfoDictionaryKey: "CallkeepScreenshotScene")
          as? String
        {
          columnVisibility = ["player", "settings"].contains(scene) ? .detailOnly : .all
          if !["menu", "menu-recording"].contains(scene) { model.configureScreenshotScene() }
        }
      #endif
    }
    .sheet(item: $showingInfo) { RecordingInfoView(model: model, recording: $0) }
    .confirmationDialog(
      model.selectedIDs.count == 1
        ? "Move recording to Trash?" : "Move \(model.selectedIDs.count) recordings to Trash?",
      isPresented: $deleting, titleVisibility: .visible
    ) {
      Button("Move to Trash", role: .destructive) { model.trashSelection() }
    }
  }
}

struct RecordingRow: View {
  let recording: Recording
  let live: Bool
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(recording.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
        Spacer(minLength: 0)
        if live { Circle().fill(.red).frame(width: 6, height: 6) }
      }
      HStack(spacing: 8) {
        Text(recording.createdAt, format: .dateTime.month(.abbreviated).day().year())
        Spacer(minLength: 8)
        if recording.state == .interrupted {
          Image(systemName: "exclamationmark.circle").help("Recording interrupted")
            .accessibilityLabel("Recording interrupted")
        }
        Text(live ? "Recording" : recording.formattedDuration).monospacedDigit()
      }.font(.caption).foregroundStyle(.secondary)
    }.padding(.horizontal, 6).padding(.vertical, 8).accessibilityElement(children: .combine)
  }
}

struct EmptyLibraryView: View {
  @Bindable var model: AppModel
  var body: some View {
    VStack(spacing: 22) {
      Image(systemName: "waveform").font(.system(size: 44, weight: .light)).foregroundStyle(
        .tertiary)
      Text(
        !model.search.isEmpty && model.filtered.isEmpty
          ? "No Results" : model.recordings.isEmpty ? "No Recordings" : "Select a Recording"
      ).font(.title2.weight(.medium))
      if model.recordings.isEmpty {
        RecordButton(model: model).controlSize(.large)
        Button("Import Recordings…") { model.importRecordings() }
          .disabled(model.isBusy || model.isRecording)
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct LiveRecordingView: View {
  @Bindable var model: AppModel
  @Binding var renamingID: UUID?
  var body: some View {
    VStack(spacing: 24) {
      if let recording = model.active {
        HStack(spacing: 10) {
          Circle().fill(.red).frame(width: 7, height: 7).accessibilityLabel("Recording")
          RecordingTitleView(
            model: model, recording: recording, renamingID: $renamingID,
            font: .system(size: 22, weight: .semibold), alignment: .center)
        }.frame(maxWidth: 500)
      }
      Text(Recording.timeString(model.elapsed)).font(.system(size: 64, weight: .light))
        .monospacedDigit()
      VStack(spacing: 16) {
        WaveformLegend()
        LiveWaveformView(samples: model.levelHistory).frame(height: 126)
      }
      RecordButton(model: model).controlSize(.large)
    }.padding(32).frame(maxWidth: 850, maxHeight: .infinity)
  }
}

/// Shared editor keeps the same Return/Escape and focus behavior during and after a call.
struct RecordingTitleView: View {
  let model: AppModel
  let recording: Recording
  @Binding var renamingID: UUID?
  var font: Font = .system(size: 27, weight: .semibold)
  var alignment: TextAlignment = .leading
  @State private var editedTitle = ""
  @FocusState private var nameFocused: Bool
  var body: some View {
    HStack(spacing: 10) {
      if renamingID == recording.id {
        TextField("Recording name", text: $editedTitle)
          .textFieldStyle(.plain).font(font).multilineTextAlignment(alignment)
          .focused($nameFocused).onSubmit { finishRename(save: true) }
          .onExitCommand { finishRename(save: false) }
          .accessibilityLabel("Recording name")
      } else {
        Text(recording.title).font(font).lineLimit(2).multilineTextAlignment(alignment)
          .onTapGesture(count: 2) { renamingID = recording.id }
        Button {
          renamingID = recording.id
        } label: {
          Image(systemName: "pencil").font(.system(size: 14)).foregroundStyle(.secondary)
            .frame(width: 28, height: 28).contentShape(Rectangle())
        }.buttonStyle(.plain).help("Rename Recording").accessibilityLabel("Rename recording")
      }
    }
    .onChange(of: renamingID, initial: true) { _, id in
      if id == recording.id {
        editedTitle = recording.title
        nameFocused = true
      }
    }
    .onChange(of: nameFocused) { _, focused in if !focused { finishRename(save: true) } }
    .onDisappear { finishRename(save: true) }
  }
  private func finishRename(save: Bool) {
    guard renamingID == recording.id else { return }
    renamingID = nil
    nameFocused = false
    if save { model.rename(recording, to: editedTitle) }
  }
}

struct RecordingDetail: View {
  @Bindable var model: AppModel
  let recording: Recording
  @Binding var renamingID: UUID?
  @State private var waveform = RecordingWaveform()
  @State private var waveformLoading = true
  @State private var waveformError = false
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 8) {
          RecordingTitleView(model: model, recording: recording, renamingID: $renamingID)
          Text(recording.createdAt, format: .dateTime.month(.wide).day().year().hour().minute())
            .font(.callout).foregroundStyle(.secondary)
        }
        Spacer(minLength: 8)
      }
      TitleSuggestionView(model: model, recording: recording)
      PlaybackTimelineView(
        playback: model.playback, waveform: waveform, waveformLoading: waveformLoading,
        waveformError: waveformError
      )
      .disabled(model.isRecording || recording.duration == 0)
      HStack(spacing: 30) {
        Spacer()
        Button {
          model.playback.seek(model.playback.currentPosition - 10)
        } label: {
          Image(systemName: "gobackward.10").font(.title2)
        }.buttonStyle(.plain).help("Back 10 seconds")
        Button {
          model.playback.toggle()
        } label: {
          Image(systemName: model.playback.isPlaying ? "pause.fill" : "play.fill")
            .font(.system(size: 24, weight: .medium)).frame(width: 64, height: 64)
            .background(.quaternary, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel(
          model.playback.isPlaying ? "Pause" : "Play recording")
        Button {
          model.playback.seek(model.playback.currentPosition + 10)
        } label: {
          Image(systemName: "goforward.10").font(.title2)
        }.buttonStyle(.plain).help("Forward 10 seconds")
        Spacer()
      }.disabled(model.isRecording || recording.duration == 0)
      Divider()
      TranscriptView(model: model, recording: recording)
        .frame(maxHeight: .infinity, alignment: .top)
    }.padding(.horizontal, 40).padding(.vertical, 28)
      .frame(maxWidth: 850).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .task(id: model.store?.folder(for: recording)) {
        waveformLoading = true
        waveformError = false
        guard let store = model.store else {
          waveformLoading = false
          waveformError = true
          return
        }
        let folder = store.folder(for: recording)
        let task = Task.detached(priority: .utility) {
          try RecordingWaveform.read(recording, folder: folder)
        }
        do {
          let result = try await withTaskCancellationHandler {
            try await task.value
          } onCancel: {
            task.cancel()
          }
          guard !Task.isCancelled else { return }
          waveform = result
          waveformLoading = false
        } catch is CancellationError {} catch {
          guard !Task.isCancelled else { return }
          waveformLoading = false
          waveformError = true
        }
      }
  }

}

private struct TitleSuggestionView: View {
  let model: AppModel
  let recording: Recording
  @State private var editing = false
  @State private var draft = ""
  var body: some View {
    if let suggestion = recording.suggestedTitle {
      VStack(alignment: .leading, spacing: 8) {
        Text("Suggested title").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        HStack {
          if editing {
            TextField("Suggested title", text: $draft).textFieldStyle(.roundedBorder)
              .onSubmit {
                model.rename(recording, to: draft)
                editing = false
              }
          } else {
            Text(suggestion).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
          }
          Button(editing ? "Save" : "Use title") {
            model.rename(recording, to: editing ? draft : suggestion)
            editing = false
          }.disabled(editing && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          if !editing {
            Button("Edit") {
              draft = suggestion
              editing = true
            }
          }
          Button {
            model.dismissTitleSuggestion(recording)
            editing = false
          } label: {
            Image(systemName: "xmark")
          }
          .buttonStyle(.plain).help("Dismiss suggestion").accessibilityLabel(
            "Dismiss suggested title")
        }
      }.padding(12).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    } else if model.titleSuggestionInProgress.contains(recording.id) {
      Label("Suggesting a title…", systemImage: "sparkles").font(.caption).foregroundStyle(
        .secondary)
    } else if let error = model.titleSuggestionErrors[recording.id], model.suggestTitles {
      HStack {
        Text(error).font(.caption).foregroundStyle(.secondary)
        Button("Retry") { model.suggestTitle(for: recording.id) }.controlSize(.small)
      }
    }
  }
}

private struct RecordingInfoView: View {
  @Environment(\.dismiss) private var dismiss
  let model: AppModel
  let recording: Recording
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Recording Info").font(.title2.weight(.semibold))
      LabeledContent("Duration", value: recording.formattedDuration)
      LabeledContent("Created", value: recording.createdAt.formatted())
      LabeledContent("Format", value: "Lossless PCM")
      if let detail = recording.interruptionDetail {
        VStack(alignment: .leading, spacing: 8) {
          Label("Interrupted", systemImage: "exclamationmark.circle").font(.callout.weight(.medium))
          Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(
            horizontal: false, vertical: true)
        }
      }
      Button("Show Files in Finder") { model.reveal(recording) }
      HStack {
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
      }
    }.padding(28).frame(width: 380)
  }
}

private struct PlaybackTimelineView: View {
  @Bindable var playback: Playback
  let waveform: RecordingWaveform
  let waveformLoading: Bool
  let waveformError: Bool
  @State private var scrubbing = false
  @State private var scrubPosition: TimeInterval = 0
  @State private var resumeAfterScrubbing = false

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !playback.isPlaying)) { _ in
      let position = scrubbing ? scrubPosition : playback.currentPosition
      VStack(spacing: 24) {
        VStack(spacing: 12) {
          WaveformLegend(
            microphoneEnabled: $playback.microphoneEnabled,
            systemAudioEnabled: $playback.systemAudioEnabled)
          Group {
            if waveformLoading {
              ProgressView("Loading waveform…").controlSize(.small)
            } else if waveformError {
              Label("Waveform unavailable", systemImage: "exclamationmark.circle")
                .font(.callout).foregroundStyle(.secondary)
            } else {
              WaveformView(
                waveform: waveform, microphoneEnabled: playback.microphoneEnabled,
                systemAudioEnabled: playback.systemAudioEnabled,
                progress: playback.duration > 0 ? position / playback.duration : 0)
            }
          }.frame(maxWidth: .infinity).frame(height: 104)
        }
        VStack(spacing: 8) {
          Slider(
            value: Binding(
              get: { position },
              set: { value in
                if scrubbing { scrubPosition = value } else { playback.seek(value) }
              }), in: 0...max(playback.duration, 0.01),
            onEditingChanged: { editing in
              if editing {
                guard !scrubbing else { return }
                scrubPosition = playback.currentPosition
                resumeAfterScrubbing = playback.isPlaying
                scrubbing = true
                playback.pause()
              } else {
                guard scrubbing else { return }
                playback.seek(scrubPosition)
                scrubbing = false
                if resumeAfterScrubbing && scrubPosition < playback.duration { playback.play() }
                resumeAfterScrubbing = false
              }
            }
          ).accessibilityLabel("Playback position")
          HStack {
            Text(Recording.timeString(position))
            Spacer()
            Text(Recording.timeString(playback.duration))
          }
          .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
      }
    }
  }
}

struct WaveformView: View {
  let waveform: RecordingWaveform
  var microphoneEnabled = true
  var systemAudioEnabled = true
  let progress: Double
  @Environment(\.colorScheme) private var colorScheme
  var body: some View {
    Canvas { context, size in
      let count = max(160, waveform.microphone.count, waveform.systemAudio.count)
      let maximum = max(waveform.microphone.max() ?? 0, waveform.systemAudio.max() ?? 0, 0.01)
      let spacing = size.width / CGFloat(count)
      for index in 0..<count {
        let x = CGFloat(index) * spacing
        let width = max(1, spacing - 2)
        let dot = CGRect(x: x, y: size.height / 2 - 1.5, width: width, height: 3)
        context.fill(Path(roundedRect: dot, cornerRadius: 2), with: .color(.primary.opacity(0.1)))
        for (values, color, enabled) in [
          (waveform.microphone, VoiceColor.microphone, microphoneEnabled),
          (waveform.systemAudio, VoiceColor.systemAudio, systemAudioEnabled),
        ] {
          guard enabled, index < values.count, values[index] > 0 else { continue }
          let height = max(3, CGFloat(sqrt(min(values[index] / maximum, 1))) * size.height)
          let rect = CGRect(x: x, y: (size.height - height) / 2, width: width, height: height)
          var layer = context
          layer.blendMode = colorScheme == .dark ? .screen : .multiply
          let opacity = Double(index) / Double(count) <= progress ? 0.95 : 0.45
          layer.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(color.opacity(opacity)))
        }
      }
    }.accessibilityLabel(
      "Recorded audio: you \(microphoneEnabled ? "shown in purple" : "hidden"), call audio \(systemAudioEnabled ? "shown in teal" : "hidden")"
    )
  }
}
