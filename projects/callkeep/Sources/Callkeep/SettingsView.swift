import CallkeepCore
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @State private var showingInfo = false
  @State private var showingLogs = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        Text("Settings").font(.system(size: 24, weight: .semibold))
        SettingsSection("General") {
          VStack(alignment: .leading, spacing: 0) {
            SettingsSwitchRow(
              "Launch at login",
              isOn: Binding(
                get: { model.launchAtLogin.enabled }, set: { model.launchAtLogin.setEnabled($0) })
            )
            .disabled(!model.launchAtLogin.canManage)
            .help(
              model.launchAtLogin.canManage
                ? "Start quietly in the menu bar when you log in"
                : "Available in the installed Callkeep app")
            if model.launchAtLogin.status == .requiresApproval {
              SettingsDivider()
              SettingsRow {
                Text("Allow Callkeep in Login Items").font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Open Settings…") { model.launchAtLogin.openSettings() }
              }
            }
            if let error = model.launchAtLogin.error {
              Text(error).font(.callout).foregroundStyle(.orange).padding(
                [.horizontal, .bottom], 16)
            }
          }
        }
        SettingsSection("Recording") {
          VStack(spacing: 0) {
            SettingsRow {
              SettingsRowIcon("keyboard")
              Text("Shortcut").frame(maxWidth: .infinity, alignment: .leading)
              Button {
                model.recordingShortcut = .default
                model.updateShortcut()
              } label: {
                Image(systemName: "arrow.counterclockwise").frame(width: 20)
              }
              .buttonStyle(.borderless).help("Reset to Default").accessibilityLabel(
                "Reset shortcut to default"
              )
              .disabled(model.recordingShortcut == .default)
              ShortcutRecorder(
                shortcut: model.recordingShortcut,
                onChange: {
                  model.recordingShortcut = $0
                  model.updateShortcut()
                }, onCaptureChanged: { model.suspendShortcut($0) }
              )
              .frame(width: 126, height: 28)
            }
            if let error = model.shortcutError {
              Label(error, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(
                .orange
              ).padding([.horizontal, .bottom], 16)
            }

          }
        }
        SettingsSection("Overlays") {
          VStack(alignment: .leading, spacing: 0) {
            SettingsSwitchRow(
              "Remind me to record calls",
              isOn: Binding(
                get: { model.callDetector.enabled }, set: { model.callDetector.enabled = $0 }))
            SettingsDivider()
            SettingsRow {
              Text("Reminder delay")
              Spacer()
              Picker(
                "Reminder delay",
                selection: Binding(
                  get: { model.callDetector.reminderDelay },
                  set: { model.callDetector.reminderDelay = $0 })
              ) {
                ForEach(CallDetector.delayOptions, id: \.self) { delay in
                  Text(
                    delay == 0.5
                      ? "0.5 seconds" : "\(Int(delay)) \(delay == 1 ? "second" : "seconds")"
                  ).tag(delay)
                }
              }.labelsHidden().fixedSize().disabled(!model.callDetector.enabled)
            }
            SettingsDivider()
            SettingsRow {
              Text("Position")
              Spacer()
              Picker("Overlay position", selection: $model.overlayPosition) {
                ForEach(OverlayPosition.allCases) { Text($0.title).tag($0) }
              }.labelsHidden().fixedSize()
            }
            if let error = model.callDetector.error {
              Text(error).font(.caption).foregroundStyle(.secondary).padding(
                [.horizontal, .bottom], 16)
            }
          }
        }
        SettingsSection("Storage") {
          VStack(alignment: .leading, spacing: 0) {
            SettingsRow {
              SettingsRowIcon("folder")
              Text("Recordings Folder")
              Spacer()
              Button("Show in Finder") {
                if let root = model.recordingsFolder {
                  do {
                    try FileManager.default.createDirectory(
                      at: root, withIntermediateDirectories: true)
                    NSWorkspace.shared.open(root)
                  } catch { model.errorMessage = error.localizedDescription }
                }
              }
            }
            SettingsDivider()
            SettingsRow {
              Text("Save finished recordings to iCloud Drive")
              Spacer()
              if model.isPreparingStorage { ProgressView().controlSize(.small) }
              SettingsSwitch("Save finished recordings to iCloud Drive", isOn: $model.iCloudEnabled)
                .onChange(of: model.iCloudEnabled) { _, _ in model.updateStorage() }
                .disabled(model.isRecording || model.isBusy || model.isPreparingStorage)
            }
            if model.storageNeedsRetry {
              HStack(alignment: .top, spacing: 12) {
                Text(model.storageStatus).font(.callout).foregroundStyle(.secondary)
                  .frame(maxWidth: .infinity, alignment: .leading)
                Button("Retry iCloud Drive") { model.updateStorage() }
                  .disabled(
                    model.isRecording || model.isBusy || model.isPreparingStorage
                      || !model.iCloudEnabled)
              }.padding([.horizontal, .bottom], 16)
            }
          }
        }
        SettingsSection("Transcription") {
          TranscriptionSettingsView(
            controller: model.transcription, notifications: model.transcriptionNotifications)
        }
        SettingsSection("Title suggestions") {
          VStack(alignment: .leading, spacing: 0) {
            SettingsSwitchRow("Suggest recording titles", isOn: $model.suggestTitles)
              .disabled(!model.titleModelAvailable)
            Text(
              "Uses your transcript and recent recording titles on this Mac. Suggestions are saved with the recording."
            )
            .font(.caption).foregroundStyle(.secondary).padding([.horizontal, .bottom], 16)
            if !model.titleModelAvailable {
              Text("Requires macOS 26 and an available Apple Intelligence on-device model.")
                .font(.caption).foregroundStyle(.secondary).padding([.horizontal, .bottom], 16)
            }
          }
        }
        SettingsSection("Speaker recognition") {
          VStack(alignment: .leading, spacing: 0) {
            SettingsSwitchRow(
              "Recognize speakers",
              isOn: Binding(
                get: { model.voiceRecognition.enabled },
                set: { model.voiceRecognition.enabled = $0 })
            )
            .disabled(!TranscriptionModel.supported)
            Text(
              "Speaker analysis, voiceprints and labels stay on this Mac until cleared. Matches need your confirmation."
            )
            .font(.caption).foregroundStyle(.secondary).padding([.horizontal, .bottom], 16)
            if model.voiceRecognition.enabled {
              SettingsDivider()
              SettingsRow {
                Text("Speaker model · 22 MB")
                Spacer()
                if model.transcription.models.installed.contains(TranscriptionModel.speakers.id) {
                  Button("Remove model") {
                    model.transcription.models.remove(TranscriptionModel.speakers.id)
                  }
                  .disabled(model.voiceRecognition.processingID != nil)
                } else if model.transcription.models.downloading == TranscriptionModel.speakers.id {
                  ProgressView(value: model.transcription.models.progress).frame(width: 90)
                  Button("Cancel") { model.transcription.models.cancelDownload() }
                } else {
                  Button("Download") {
                    model.transcription.models.download(TranscriptionModel.speakers.id)
                  }
                  .disabled(model.transcription.models.downloading != nil)
                }
              }
            }
            ForEach(model.voiceRecognition.profiles) { profile in
              SettingsDivider()
              RememberedVoiceRow(voice: model.voiceRecognition, profile: profile)
            }
            if !model.voiceRecognition.profiles.isEmpty
              || !model.voiceRecognition.recordings.isEmpty
            {
              SettingsDivider()
              SettingsRow {
                Text("Saved speaker labels and voice profiles")
                Spacer()
                Button("Clear all") { model.voiceRecognition.clearAll() }
              }
            }
            if let error = model.voiceRecognition.error ?? model.transcription.models.error {
              Text(error).font(.caption).foregroundStyle(.orange).padding(
                [.horizontal, .bottom], 16)
            }
          }
        }
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Text("Permissions").font(.system(size: 12, weight: .semibold)).foregroundStyle(
              .secondary)
            Spacer()
            Menu {
              Button("Microphone…") { model.permissions.openSettings(for: .microphone) }
              Button("System Audio…") { model.permissions.openSettings(for: .systemAudio) }
              Button("Notifications…") { model.transcriptionNotifications.openSettings() }
            } label: {
              Image(systemName: "ellipsis").frame(width: 24, height: 20)
            }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
              .accessibilityLabel("Permission settings").help("Permission settings").disabled(
                model.isRecording)
          }
          RecordingAccessView(
            permissions: model.permissions, notifications: model.transcriptionNotifications,
            recording: model.isRecording
          ).modifier(SettingsSurface())
        }
        SettingsSection("Diagnostics") {
          SettingsRow {
            Text("Application logs")
            Spacer()
            Button("View Logs…") { showingLogs = true }
          }
        }
        HStack {
          Text(
            "Callkeep · Build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "4")")
          Spacer()
          Button("About Callkeep") { showingInfo = true }.buttonStyle(.link)
        }.font(.caption).foregroundStyle(.secondary)
      }.frame(maxWidth: 560).padding(32).frame(maxWidth: .infinity, alignment: .top)
    }
    .task {
      model.launchAtLogin.refresh()
      while !Task.isCancelled {
        model.permissions.refresh()
        await model.transcriptionNotifications.refresh()
        do { try await Task.sleep(for: .seconds(1)) } catch { return }
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification))
    { _ in
      model.launchAtLogin.refresh()
      model.permissions.refresh()
      Task { await model.transcriptionNotifications.refresh() }
    }
    .sheet(isPresented: $showingInfo) {
      VStack(alignment: .leading, spacing: 18) {
        Text("About Callkeep").font(.title2.weight(.semibold))
        Text(
          "Callkeep records your default microphone and audio from all apps. Muting in a call does not mute Callkeep."
        )
        Text(
          "Audio uses about 1 GB per hour. Finished recordings move to iCloud Drive when enabled and available. Changing audio devices or sleeping the Mac ends the recording."
        )
        Text("Get everyone’s agreement before recording.")
        HStack {
          Spacer()
          Button("Done") { showingInfo = false }.keyboardShortcut(.defaultAction)
        }
      }.padding(26).frame(width: 380)
    }
    .sheet(isPresented: $showingLogs) { DiagnosticLogView() }
  }
}

private struct DiagnosticLogView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var contents = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Application Logs").font(.title2.weight(.semibold))
      Text(
        "Events, timestamps and error codes only. Recordings, transcript text, titles, and speaker names are not included."
      )
      .font(.callout).foregroundStyle(.secondary)
      ScrollView([.vertical, .horizontal]) {
        Text(contents).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading).padding(12)
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
      HStack {
        Button("Show in Finder") {
          NSWorkspace.shared.activateFileViewerSelecting([AppLog.shared.directory])
        }
        Button("Refresh") { contents = AppLog.shared.contents() }
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
      }
    }.padding(24).frame(minWidth: 560, minHeight: 380)
      .onAppear { contents = AppLog.shared.contents() }
  }
}

private struct RememberedVoiceRow: View {
  let voice: VoiceRecognition
  let profile: RememberedVoice
  @State private var editing = false
  @State private var name = ""
  var body: some View {
    SettingsRow {
      if editing {
        TextField("Speaker name", text: $name).textFieldStyle(.roundedBorder)
      } else {
        Text(profile.name)
      }
      Spacer()
      Button(editing ? "Save" : "Rename") {
        if editing {
          voice.renameProfile(profile.id, name: name)
          editing = false
        } else {
          name = profile.name
          editing = true
        }
      }.disabled(editing && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      Button("Forget voice") { voice.removeProfile(profile.id) }
    }
  }
}
