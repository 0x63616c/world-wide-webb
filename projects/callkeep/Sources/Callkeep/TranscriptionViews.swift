import CallkeepCore
import SwiftUI

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
        .onChange(of: controller.notifyWhenReady) { _, value in
          if value { notifications.requestIfNeeded() }
        }
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
                  Text(
                    ByteCountFormatter.string(
                      fromByteCount: Int64(controller.models.bytesPerSecond), countStyle: .file)
                      + "/s")
                }
              }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Button("Cancel") { controller.models.cancelDownload() }
          } else if controller.models.installed.contains(model.id) {
            SettingsHoverAction(
              title: "Remove \(model.name)", symbol: "trash", hovering: hoveredModelID == model.id
            ) {
              removingModel = model
            }.disabled(controller.runningModelID == model.id)
          } else {
            Button {
              controller.models.download(model.id)
            } label: {
              Image(systemName: "arrow.down.circle").font(.system(size: 16)).frame(
                width: 24, height: 24)
            }.buttonStyle(.borderless).foregroundStyle(.secondary)
              .help("Download \(model.name)").accessibilityLabel("Download \(model.name)")
              .disabled(controller.models.downloading != nil || !TranscriptionModel.supported)
          }
        }.contentShape(Rectangle())
          .onHover { hovering in
            if hovering {
              hoveredModelID = model.id
            } else if hoveredModelID == model.id {
              hoveredModelID = nil
            }
          }
      }
      HStack {
        Text("All audio is processed locally").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button("Credits") { showingCredits = true }.buttonStyle(.link).font(.caption)
      }.padding(16)
      if !TranscriptionModel.supported {
        Text("Local transcription requires Apple silicon.").font(.callout).foregroundStyle(
          .secondary
        ).padding([.horizontal, .bottom], 16)
      }
      if let error = controller.models.error ?? controller.error {
        Text(error).font(.callout).foregroundStyle(.orange).textSelection(.enabled).padding(
          [.horizontal, .bottom], 16)
      }
    }
    .confirmationDialog(
      removingModel.map { "Remove \($0.name)?" } ?? "Remove model?",
      isPresented: Binding(get: { removingModel != nil }, set: { if !$0 { removingModel = nil } }),
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        if let model = removingModel, controller.runningModelID != model.id {
          controller.models.remove(model.id)
        }
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
          Text(
            (Bundle.main.url(forResource: "Transcription-LICENSES", withExtension: "txt").flatMap {
              try? String(contentsOf: $0, encoding: .utf8)
            }) ?? "Credits unavailable"
          )
          .font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
        HStack {
          Spacer()
          Button("Done") { showingCredits = false }.keyboardShortcut(.defaultAction)
        }
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
  private var status: String? { controller.status(for: recording.id) }
  private var job: TranscriptionJob? { controller.jobs.first { $0.recordingID == recording.id } }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 12) {
        Text("Transcript").font(.headline)
        Spacer()
        if let selected, status == nil {
          Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(selected.plainText, forType: .string)
          } label: {
            Image(systemName: "doc.on.doc").frame(width: 24, height: 24)
          }
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
              Button(
                choice.name
                  + (controller.models.installed.contains(choice.id) ? "" : " (download required)")
              ) {
                controller.enqueue(recording, modelID: choice.id)
              }
            }
          }
        } label: {
          Image(systemName: "ellipsis").frame(width: 24, height: 24)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .help("Transcript actions").accessibilityLabel("Transcript actions")
        .disabled(model.isRecording || status != nil || !TranscriptionModel.supported)
      }
      if let status {
        TranscriptionProgressView(
          status: status,
          fraction: controller.runningID == recording.id ? controller.progressFraction : nil,
          working: controller.runningID == recording.id && !controller.isPaused,
          paused: controller.isPaused, failed: job?.state == .failed,
          needsModel: job.map { !controller.models.installed.contains($0.modelID) } ?? false,
          modelName: job.flatMap { TranscriptionModel.find($0.modelID)?.name },
          retry: { controller.retry(recording.id) }, models: { model.showSettings() },
          cancel: { controller.cancel(recording.id) })
      }
      if let readError = readError ?? controller.error {
        Text(readError).font(.callout).foregroundStyle(.orange)
      }
      if let selected, status == nil {
        if model.voiceRecognition.enabled
          && model.voiceRecognition.analysis(for: recording.id) == nil
        {
          SpeakerRecognitionView(model: model, recording: recording)
        }
        if selected.segments.isEmpty {
          ContentUnavailableView(
            "No speech found", systemImage: "text.bubble",
            description: Text("The selected model didn’t detect speech in this recording.")
          )
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
                    let label = speakerLabel(for: segment)
                    VStack(alignment: .leading, spacing: 6) {
                      HStack(spacing: 10) {
                        if let speaker = speakerID(for: segment), model.voiceRecognition.enabled {
                          SpeakerIdentityButton(
                            model: model, recording: recording, speaker: speaker, label: label)
                        } else {
                          Text(label).font(.caption.weight(.semibold))
                            .foregroundStyle(
                              segment.source == .microphone
                                ? VoiceColor.microphone : VoiceColor.systemAudio)
                        }
                        Text(Recording.timeString(segment.start))
                          .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                      }
                      Button {
                        model.playback.seek(segment.start)
                      } label: {
                        Text(segment.text).font(.system(size: 16))
                          .lineSpacing(4).frame(maxWidth: .infinity, alignment: .leading)
                          .contentShape(Rectangle())
                      }.buttonStyle(.plain).help("Seek to \(Recording.timeString(segment.start))")
                        .accessibilityLabel(
                          "\(label), \(Recording.timeString(segment.start)): \(segment.text)")
                    }.padding(.horizontal, 12).padding(.vertical, 14)
                      .frame(maxWidth: .infinity, alignment: .leading)
                      .background(
                        active ? Color.accentColor.opacity(0.10) : .clear,
                        in: RoundedRectangle(cornerRadius: 8)
                      )
                      .id(segment.id)
                  }
                }.padding(.vertical, 4)
              }
              .onChange(of: currentID) { _, id in
                guard let id else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                  proxy.scrollTo(id, anchor: .center)
                }
              }
            }
          }
        }
        HStack {
          if results.count > 1 {
            Menu {
              ForEach(results) { result in
                Button {
                  resultID = result.id
                } label: {
                  if result.id == selected.id {
                    Label(
                      "\(result.modelName) · \(result.createdAt.formatted(date: .omitted, time: .shortened))",
                      systemImage: "checkmark")
                  } else {
                    Text(
                      "\(result.modelName) · \(result.createdAt.formatted(date: .omitted, time: .shortened))"
                    )
                  }
                }
              }
            } label: {
              Text(selected.modelName)
            }
            .menuStyle(.borderlessButton).fixedSize()
            .accessibilityLabel("Transcript version")
          } else {
            Text(selected.modelName)
          }
          Spacer()
        }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12)
      } else if controller.status(for: recording.id) == nil {
        ContentUnavailableView(
          "No transcript yet", systemImage: "text.bubble",
          description: Text("Choose a model to transcribe this recording locally.")
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
      }
    }
    .task(
      id:
        "\(recording.id)-\(controller.resultsVersion)-\(model.store?.folder(for: recording).path ?? "")"
    ) {
      guard let folder = model.store?.folder(for: recording) else { return }
      do {
        let loaded = try await Task.detached(priority: .utility) {
          try TranscriptFiles.load(folder: folder)
        }.valueWithCancellation()
        guard !Task.isCancelled else { return }
        results = loaded
        readError = nil
        if model.suggestTitles, let transcript = loaded.first {
          model.suggestTitle(for: recording.id, transcript: transcript)
        }
        if !loaded.isEmpty { model.identifySpeakers(for: recording.id) }
      } catch is CancellationError {} catch {
        readError = "Couldn’t load transcripts: \(error.localizedDescription)"
      }
    }
  }
  private func speakerLabel(for segment: TranscriptSegment) -> String {
    guard let id = speakerID(for: segment),
      let speakers = model.voiceRecognition.analysis(for: recording.id)
    else { return segment.source.label }
    if let name = speakers.confirmedNames[id] { return name }
    let ids =
      Array(NSOrderedSet(array: speakers.analysis.turns.map(\.speakerID))) as? [String] ?? []
    return "Speaker \((ids.firstIndex(of: id) ?? 0) + 1)"
  }
  private func speakerID(for segment: TranscriptSegment) -> String? {
    guard segment.source == .systemAudio,
      let speakers = model.voiceRecognition.analysis(for: recording.id)
    else { return nil }
    let overlap = speakers.analysis.turns.filter {
      $0.start < segment.end && $0.end > segment.start
    }
    return overlap.max(by: {
      min($0.end, segment.end) - max($0.start, segment.start) < min($1.end, segment.end)
        - max($1.start, segment.start)
    })?.speakerID
  }
}

private struct SpeakerRecognitionView: View {
  let model: AppModel
  let recording: Recording
  var body: some View {
    let voice = model.voiceRecognition
    if voice.processingID == recording.id {
      Label("Identifying speakers…", systemImage: "waveform").font(.caption).foregroundStyle(
        .secondary)
    } else if !model.transcription.models.installed.contains(TranscriptionModel.speakers.id) {
      Text("Download the speaker model in Settings to identify voices.").font(.caption)
        .foregroundStyle(.secondary)
    } else if let error = voice.error {
      HStack {
        Text(error).font(.caption).foregroundStyle(.secondary)
        Button("Retry") { model.identifySpeakers(for: recording.id) }
      }
    } else {
      Button("Identify speakers") { model.identifySpeakers(for: recording.id) }.disabled(
        model.isRecording || model.isBusy)
    }
  }
}

private struct SpeakerIdentityButton: View {
  let model: AppModel
  let recording: Recording
  let speaker: String
  let label: String
  @State private var showing = false
  @State private var name = ""
  @State private var remember = false
  var body: some View {
    let voice = model.voiceRecognition
    let confirmed = voice.analysis(for: recording.id)?.confirmedNames[speaker]
    let suggested = confirmed == nil ? voice.suggestedName(for: speaker, in: recording.id) : nil
    Button {
      name = confirmed ?? ""
      remember = false
      showing = true
    } label: {
      HStack(spacing: 4) {
        Text(label).font(.caption.weight(.semibold))
        Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
      }
      .foregroundStyle(VoiceColor.systemAudio)
    }
    .buttonStyle(.plain).help("Name or review speaker")
    .popover(isPresented: $showing, arrowEdge: .top) {
      VStack(alignment: .leading, spacing: 14) {
        Text(confirmed == nil ? "Name this speaker" : "Speaker name").font(.headline)
        if let suggested {
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text("Possible match").font(.caption).foregroundStyle(.secondary)
              Text(suggested).font(.callout.weight(.medium))
            }
            Spacer()
            Button("Use name") {
              voice.confirm(speaker, name: suggested, remember: false, in: recording.id)
              showing = false
            }
          }.padding(10).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        }
        TextField("Enter a name", text: $name).textFieldStyle(.roundedBorder)
          .onSubmit { save() }
        Toggle("Remember this voice", isOn: $remember).toggleStyle(.checkbox)
        HStack {
          Button("Listen") {
            if let turn = voice.analysis(for: recording.id)?.analysis.turns.first(where: {
              $0.speakerID == speaker
            }) {
              model.playback.seek(turn.start)
              if !model.playback.isPlaying { model.playback.toggle() }
            }
          }.buttonStyle(.link)
          Spacer()
          Button("Save") { save() }.buttonStyle(.borderedProminent)
            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        if model.suggestTitles, model.titleModelAvailable, AppModel.isDefaultTitle(recording.title),
          confirmed != nil,
          recording.titleSuggestionDismissed != true
        {
          Button("Suggest title with confirmed speakers") {
            model.suggestTitle(for: recording.id, useConfirmedSpeakers: true)
            showing = false
          }
          .buttonStyle(.link).font(.caption).disabled(
            model.titleSuggestionInProgress.contains(recording.id))
        }
      }.padding(16).frame(width: 280)
    }
  }
  private func save() {
    guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    model.voiceRecognition.confirm(speaker, name: name, remember: remember, in: recording.id)
    showing = false
  }
}

private struct TranscriptionProgressView: View {
  let status: String
  let fraction: Double?
  let working: Bool
  let paused: Bool
  let failed: Bool
  let needsModel: Bool
  let modelName: String?
  let retry: () -> Void
  let models: () -> Void
  let cancel: () -> Void
  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 12)
      VStack(spacing: 12) {
        if let fraction {
          ZStack {
            Circle().stroke(.quaternary, lineWidth: 4)
            Circle().trim(from: 0, to: fraction)
              .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 4, lineCap: .round))
              .rotationEffect(.degrees(-90))
            Text("\(Int((fraction * 100).rounded(.down)))%")
              .font(.callout.monospacedDigit())
          }.frame(width: 64, height: 64)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Overall transcription progress")
            .accessibilityValue("\(Int((fraction * 100).rounded(.down))) percent")
        } else if working {
          ProgressView().controlSize(.large).frame(width: 64, height: 64)
        } else {
          Image(
            systemName: failed
              ? "exclamationmark.circle"
              : needsModel ? "arrow.down.circle" : paused ? "pause.circle" : "clock"
          )
          .font(.system(size: 28, weight: .light)).foregroundStyle(.secondary)
          .frame(width: 64, height: 64).accessibilityHidden(true)
        }
        Text(status).font(.callout).foregroundStyle(.secondary)
          .multilineTextAlignment(.center).textSelection(.enabled)
        HStack(spacing: 16) {
          if failed { Button("Retry", action: retry) }
          if needsModel { Button("Models…", action: models) }
          Button(action: cancel) { Image(systemName: "xmark").frame(width: 28, height: 28) }
            .buttonStyle(.plain).foregroundStyle(.secondary)
            .help("Cancel transcription").accessibilityLabel("Cancel transcription")
        }
      }.frame(maxWidth: .infinity)
      Spacer(minLength: 12)
      if let modelName {
        Text(modelName).font(.caption).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12)
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
