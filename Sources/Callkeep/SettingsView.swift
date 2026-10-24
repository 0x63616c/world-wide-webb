import SwiftUI
import CallkeepCore

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showingInfo = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text("Settings").font(.system(size: 24, weight: .semibold))
                section("Recording") {
                    VStack(spacing: 0) {
                        HStack(spacing: 12) {
                            rowIcon("keyboard")
                            Text("Shortcut").frame(maxWidth: .infinity, alignment: .leading)
                            Button {
                                model.recordingShortcut = .default; model.updateShortcut()
                            } label: { Image(systemName: "arrow.counterclockwise").frame(width: 20) }
                                .buttonStyle(.borderless).help("Reset to Default").accessibilityLabel("Reset shortcut to default")
                                .disabled(model.recordingShortcut == .default)
                            ShortcutRecorder(shortcut: model.recordingShortcut, onChange: {
                                model.recordingShortcut = $0; model.updateShortcut()
                            }, onCaptureChanged: { model.suspendShortcut($0) })
                                .frame(width: 126, height: 28)
                        }.frame(minHeight: 54).padding(.horizontal, 16)
                        if let error = model.shortcutError {
                            Label(error, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(.orange).padding([.horizontal, .bottom], 16)
                        }
                        Divider().padding(.leading, 48)
                        HStack(spacing: 12) {
                            rowIcon("folder")
                            Text("Recordings Folder")
                            Spacer()
                            Button("Show in Finder") { if let root = model.store?.root { NSWorkspace.shared.open(root) } }
                        }.frame(minHeight: 54).padding(.horizontal, 16)
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Permissions").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                        Spacer()
                        Menu("Manage…") {
                            Button("Microphone…") { model.permissions.openSettings(for: .microphone) }
                            Button("System Audio…") { model.permissions.openSettings(for: .systemAudio) }
                        }.menuStyle(.borderlessButton).fixedSize().font(.callout).disabled(model.isRecording)
                    }
                    RecordingAccessView(permissions: model.permissions, recording: model.isRecording).modifier(SettingsSurface())
                }
                HStack {
                    Text("Callkeep \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1")")
                    Spacer()
                    Button("About Recording") { showingInfo = true }.buttonStyle(.link)
                }.font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: 560).padding(32).frame(maxWidth: .infinity, alignment: .top)
        }
        .task {
            while !Task.isCancelled {
                model.permissions.refresh()
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
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
    private func rowIcon(_ name: String) -> some View {
        Image(systemName: name).font(.system(size: 16)).foregroundStyle(.secondary).frame(width: 24)
    }
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            content().modifier(SettingsSurface())
        }
    }
}

private struct SettingsSurface: ViewModifier {
    func body(content: Content) -> some View {
        content.background(.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
    }
}
