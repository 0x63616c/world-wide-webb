import SwiftUI
import CallkeepCore

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showingInfo = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings").font(.system(size: 24, weight: .semibold))

                settingsSection("Keyboard Shortcut") {
                    HStack(spacing: 10) {
                        Text("Start / stop recording").frame(maxWidth: .infinity, alignment: .leading)
                        ShortcutRecorder(shortcut: model.recordingShortcut, onChange: {
                            model.recordingShortcut = $0; model.updateShortcut()
                        }, onCaptureChanged: { model.suspendShortcut($0) })
                            .frame(width: 138, height: 28).disabled(!model.shortcutEnabled)
                        Button {
                            model.recordingShortcut = .default; model.shortcutEnabled = true; model.updateShortcut()
                        } label: { Image(systemName: "arrow.counterclockwise") }
                            .buttonStyle(.borderless).frame(width: 24)
                            .help("Reset to Default").accessibilityLabel("Reset shortcut to default")
                            .disabled(model.recordingShortcut == .default && model.shortcutEnabled)
                        Toggle("Keyboard shortcut", isOn: $model.shortcutEnabled).labelsHidden().toggleStyle(.switch).controlSize(.small)
                            .onChange(of: model.shortcutEnabled) { model.updateShortcut() }
                    }.frame(minHeight: 52)
                    if let error = model.shortcutError {
                        Label(error, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(.orange).padding(.bottom, 12)
                    }
                }

                settingsSection("Recording Access") {
                    RecordingAccessView(permissions: model.permissions, recording: model.isRecording)
                }

                settingsSection("Storage") {
                    HStack(spacing: 12) {
                        Image(systemName: "folder").font(.system(size: 16)).foregroundStyle(.secondary).frame(width: 24)
                        Text("Recordings")
                        Spacer()
                        Button("Show in Finder") { if let root = model.store?.root { NSWorkspace.shared.open(root) } }
                    }.frame(minHeight: 52)
                }

                HStack {
                    Text("Callkeep \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1")")
                    Spacer()
                    Button("About Recording") { showingInfo = true }.buttonStyle(.link)
                }.font(.callout).foregroundStyle(.secondary)
            }.frame(maxWidth: 600).padding(28).frame(maxWidth: .infinity, alignment: .top)
        }
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

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary).padding(.bottom, 8)
            Divider()
            content()
        }
    }
}
