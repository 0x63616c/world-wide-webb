import AppKit
import AVFoundation
import Observation
import SwiftUI
import UserNotifications
import CallkeepCore

@MainActor @Observable
final class Permissions {
    enum Kind { case microphone, systemAudio }
    var microphone = AVCaptureDevice.authorizationStatus(for: .audio)
    var system: AudioPermissionState = .unavailable
    var requestingMicrophone = false
    private let audioAuthorization = SystemAudioAuthorization()

    // The public capture API remains usable if the optional query disappears.
    // Never turn an unavailable status into an "Allowed" indicator.
    var canRecord: Bool { microphone == .authorized && (system == .allowed || system == .unavailable) }
    init() { refresh() }
    func refresh() {
        microphone = AVCaptureDevice.authorizationStatus(for: .audio)
        system = audioAuthorization.status
    }
    func isAllowed(_ kind: Kind) -> Bool {
        kind == .microphone ? microphone == .authorized : system == .allowed
    }
    func enableMicrophone() async {
        guard !requestingMicrophone else { return }
        refresh()
        if microphone == .notDetermined {
            requestingMicrophone = true
            _ = await AVCaptureDevice.requestAccess(for: .audio)
            requestingMicrophone = false
            refresh()
        } else if microphone != .authorized { openSettings(for: .microphone) }
    }
    func openSettings(for kind: Kind) {
        refresh()
        PermissionCompanion.shared.dismiss()
        let pane = kind == .microphone ? "Privacy_Microphone" : "Privacy_AudioCapture"
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") else { return }
        NSWorkspace.shared.open(url)
        if !isAllowed(kind) { PermissionCompanion.shared.show(permissions: self, kind: kind) }
    }
}

struct RecordingAccessView: View {
    @Bindable var permissions: Permissions
    let notifications: TranscriptionNotifications
    var recording: Bool

    var body: some View {
        VStack(spacing: 0) {
            accessRow("Microphone", symbol: "mic", allowed: permissions.microphone == .authorized) {
                if permissions.requestingMicrophone { ProgressView().controlSize(.small) }
                else { Button("Enable") { Task { await permissions.enableMicrophone() } } }
            }
            SettingsDivider()
            accessRow("System Audio", symbol: "speaker.wave.2", allowed: permissions.system == .allowed, unknown: permissions.system == .unavailable) {
                Button(permissions.system == .unavailable ? "Settings…" : "Enable") { permissions.openSettings(for: .systemAudio) }
            }
            SettingsDivider()
            accessRow("Notifications", symbol: "bell", allowed: notifications.allowed, unknown: notifications.authorizationStatus == nil) {
                if notifications.authorizationStatus == .notDetermined {
                    Button("Enable") { notifications.requestIfNeeded() }
                } else {
                    Button("Settings…") { notifications.openSettings() }
                }
            }
        }.disabled(recording)
    }

    private func accessRow<Action: View>(_ title: String, symbol: String, allowed: Bool, unknown: Bool = false, @ViewBuilder action: () -> Action) -> some View {
        SettingsRow {
            SettingsRowIcon(symbol)
            Text(title)
            Spacer()
            HStack(spacing: 6) {
                Group {
                    if allowed { Text("Allowed").font(.callout).foregroundStyle(.green) }
                    else { action() }
                }.fixedSize()
                Image(systemName: allowed ? "checkmark.circle.fill" : unknown ? "questionmark.circle" : "xmark.circle.fill")
                    .foregroundStyle(allowed ? Color.green : unknown ? Color.secondary : Color.red)
                    .frame(width: 14).accessibilityLabel(allowed ? "Allowed" : unknown ? "Status unavailable" : "Access required")
            }.frame(width: 100, alignment: .trailing)
        }
    }
}
