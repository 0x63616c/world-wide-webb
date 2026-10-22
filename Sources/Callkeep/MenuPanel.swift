import SwiftUI
import CallkeepCore

struct MenuPanel: View {
    @Bindable var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Callkeep").font(.headline)
                Spacer()
                if model.isRecording {
                    Circle().fill(.red).frame(width: 6, height: 6)
                    Text(Recording.timeString(model.elapsed)).font(.body.monospacedDigit())
                }
            }
            if model.isRecording { WaveformView(peaks: model.levelHistory, progress: 1, live: true).frame(height: 32) }
            HStack { RecordButton(model: model); Spacer(); if model.shortcutEnabled { Text(model.shortcutLabel).font(.caption.monospaced()).foregroundStyle(.secondary) } }
            if let error = model.errorMessage { Text(error).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            Divider()
            Button { openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true) } label: { Label("Recordings", systemImage: "rectangle.stack") }.buttonStyle(.plain)
            HStack {
                SettingsLink { Label("Settings…", systemImage: "gearshape") }.buttonStyle(.plain)
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }.buttonStyle(.plain).foregroundStyle(.secondary)
            }
        }.padding(18).frame(width: 300)
    }
}

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showingInfo = false
    var body: some View {
        Form {
            Section("Recording") {
                Toggle("Keyboard shortcut", isOn: $model.shortcutEnabled).onChange(of: model.shortcutEnabled) { model.updateShortcut() }
                LabeledContent("Start / stop") {
                    ShortcutRecorder(shortcut: model.recordingShortcut, onChange: { model.recordingShortcut = $0; model.updateShortcut() }, onCaptureChanged: { model.suspendShortcut($0) })
                        .frame(width: 160, height: 26).disabled(!model.shortcutEnabled)
                }
                Button("Reset to Default") { model.recordingShortcut = .default; model.shortcutEnabled = true; model.updateShortcut() }
                    .disabled(model.recordingShortcut == .default && model.shortcutEnabled)
                if let error = model.shortcutError { Text(error).foregroundStyle(.orange) }
            }
            Section("Access") {
                LabeledContent("Microphone", value: model.permissions.microphone == .authorized ? "Allowed" : "Required")
                LabeledContent("System Audio", value: model.permissions.systemLabel)
                Button("Manage Access…") { PermissionsWindow.shared.show(model.permissions) }.disabled(model.isRecording)
            }
            Section("Storage") {
                LabeledContent("Location", value: "This Mac")
                Button("Show in Finder") { if let root = model.store?.root { NSWorkspace.shared.open(root) } }
            }
            HStack {
                Text("Callkeep 0.1").foregroundStyle(.secondary)
                Spacer()
                Button { showingInfo = true } label: { Image(systemName: "info.circle") }.buttonStyle(.plain).help("About recording")
            }
        }.formStyle(.grouped).frame(width: 440, height: 500)
        .onAppear { model.permissions.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in model.permissions.refresh() }
        .sheet(isPresented: $showingInfo) {
            VStack(alignment: .leading, spacing: 18) {
                Text("About Recording").font(.title2.weight(.semibold))
                Text("Callkeep records your default microphone and audio from all apps. Muting in a call does not mute Callkeep.")
                Text("Audio stays on this Mac and uses about 1 GB per hour. Changing audio devices or sleeping the Mac ends the recording.")
                Text("Get everyone’s agreement before recording.")
                HStack { Spacer(); Button("Done") { showingInfo = false }.keyboardShortcut(.defaultAction) }
            }.padding(26).frame(width: 380)
        }
    }
}
