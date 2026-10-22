import AppKit
import AVFoundation
import Observation
import SwiftUI

private final class AudioProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var audible = false
    func receive(_ buffer: AVAudioPCMBuffer) {
        guard let data = buffer.floatChannelData else { return }
        let count = Int(buffer.frameLength) * (buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1)
        let hasAudio = (0..<count).contains { abs(data[0][$0]) > 0.00001 }
        if hasAudio { lock.lock(); audible = true; lock.unlock() }
    }
    var receivedAudio: Bool { lock.lock(); defer { lock.unlock() }; return audible }
}

@MainActor @Observable
final class Permissions {
    enum SystemState { case unchecked, previouslyVerified, checking, verified, needsAttention }
    var microphone = AVCaptureDevice.authorizationStatus(for: .audio)
    var system: SystemState = UserDefaults.standard.bool(forKey: "systemAudioVerified") ? .previouslyVerified : .unchecked
    var message: String?
    var canRecord: Bool { microphone == .authorized && (system == .verified || system == .previouslyVerified) }
    var checking: Bool { system == .checking }
    func refresh() { microphone = AVCaptureDevice.authorizationStatus(for: .audio) }
    func requestMicrophone() async {
        if microphone == .notDetermined { _ = await AVCaptureDevice.requestAccess(for: .audio); refresh() }
        else if microphone != .authorized { openSettings(microphone: true) }
    }
    func checkSystemAudio() async {
        guard !checking else { return }
        system = .checking; message = nil
        let tap = SystemAudioTap(); let probe = AudioProbe()
        defer {
            tap.stop()
            if system == .needsAttention { UserDefaults.standard.set(false, forKey: "systemAudioVerified") }
        }
        do {
            try tap.start { buffer, _ in probe.receive(buffer) }
            // Give the user time to answer the first OS prompt. No audio is saved.
            for attempt in 0..<20 {
                if attempt == 1 || attempt == 8 { NSSound(named: "Pop")?.play() }
                try await Task.sleep(for: .milliseconds(500))
                if probe.receivedAudio {
                    system = .verified; UserDefaults.standard.set(true, forKey: "systemAudioVerified"); return
                }
            }
            system = .needsAttention
            message = "Allow Callkeep in System Settings, play some audio, then check again."
        } catch {
            system = .needsAttention; message = "System audio couldn’t be verified. Check access in System Settings."
        }
    }
    func openSettings(microphone: Bool) {
        let pane = microphone ? "Privacy_Microphone" : "Privacy_AudioCapture"
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!)
    }
    var systemLabel: String {
        switch system {
        case .unchecked: "Not checked"
        case .previouslyVerified: "Verified before"
        case .checking: "Checking…"
        case .verified: "Verified"
        case .needsAttention: "Check access"
        }
    }
}


struct RecordingAccessView: View {
    @Bindable var permissions: Permissions
    var recording: Bool
    @State private var showingHelp = false

    var body: some View {
        VStack(spacing: 0) {
            accessRow("Microphone", symbol: "mic", state: microphoneState) {
                Button(permissions.microphone == .notDetermined ? "Allow…" : "Settings…") {
                    if permissions.microphone == .authorized { permissions.openSettings(microphone: true) }
                    else { Task { await permissions.requestMicrophone() } }
                }
            }
            Divider()
            accessRow("System Audio", symbol: "speaker.wave.2", state: systemState) {
                Button(permissions.checking ? "Checking…" : "Check Access") {
                    Task { await permissions.checkSystemAudio() }
                }.disabled(permissions.checking)
            }
            Divider()
            HStack {
                Button("System Settings…") { permissions.openSettings(microphone: false) }
                Spacer()
                Button { showingHelp.toggle() } label: { Label("App Missing?", systemImage: "questionmark.circle") }
            }.buttonStyle(.link).font(.callout).padding(.vertical, 14)

            if permissions.checking {
                Text("Listening for a test sound. Nothing is saved.")
                    .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 14)
            }
            if let message = permissions.message {
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 14)
            }
            if showingHelp {
                HStack(spacing: 16) {
                    Image(nsImage: NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath))
                        .resizable().frame(width: 48, height: 48)
                        .onDrag { NSItemProvider(object: Bundle.main.bundleURL as NSURL) }
                        .accessibilityLabel("Drag Callkeep into System Settings")
                    Text("Drag Callkeep into System Audio Recording Only, then turn it on.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                    .padding(.bottom, 14)
            }
        }.disabled(recording)
    }

    private var microphoneState: AccessState {
        switch permissions.microphone {
        case .authorized: .allowed("Allowed")
        case .denied, .restricted: .blocked("Not Allowed")
        default: .unknown("Required")
        }
    }
    private var systemState: AccessState {
        switch permissions.system {
        case .verified: .allowed("Verified")
        case .previouslyVerified: .previous("Verified before")
        case .checking: .checking
        case .needsAttention: .warning("Check Access")
        case .unchecked: .unknown("Not Checked")
        }
    }
    private func accessRow<Action: View>(_ title: String, symbol: String, state: AccessState, @ViewBuilder action: () -> Action) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 16)).foregroundStyle(.secondary).frame(width: 24)
            Text(title).frame(maxWidth: .infinity, alignment: .leading)
            AccessStatus(state: state).frame(width: 126, alignment: .leading)
            action().frame(width: 104, alignment: .trailing).controlSize(.regular)
        }.frame(minHeight: 52)
    }
}

private enum AccessState {
    case allowed(String), blocked(String), unknown(String), previous(String), warning(String), checking
    var label: String {
        switch self {
        case .allowed(let label), .blocked(let label), .unknown(let label), .previous(let label), .warning(let label): label
        case .checking: "Checking…"
        }
    }
    var symbol: String {
        switch self {
        case .allowed: "checkmark.circle.fill"
        case .blocked: "xmark.circle.fill"
        case .unknown: "minus.circle"
        case .previous: "clock"
        case .warning: "exclamationmark.circle.fill"
        case .checking: "circle.dotted"
        }
    }
    var color: Color {
        switch self {
        case .allowed: .green
        case .blocked: .red
        case .warning: .orange
        default: .secondary
        }
    }
}

private struct AccessStatus: View {
    let state: AccessState
    var body: some View {
        HStack(spacing: 7) {
            if case .checking = state { ProgressView().controlSize(.mini).frame(width: 14) }
            else { Image(systemName: state.symbol).foregroundStyle(state.color).frame(width: 14) }
            Text(state.label).foregroundStyle(.secondary)
        }.font(.callout).accessibilityElement(children: .combine)
        .help({
            if case .previous = state { return "Verified in a previous session. Check Access to verify again." }
            if case .allowed("Verified") = state { return "System audio was received during the latest check." }
            return state.label
        }())
    }
}
