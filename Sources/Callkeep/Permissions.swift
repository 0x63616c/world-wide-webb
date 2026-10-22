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
        defer { tap.stop() }
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
        case .previouslyVerified: "Previously verified"
        case .checking: "Checking…"
        case .verified: "Verified"
        case .needsAttention: "Check access"
        }
    }
}

struct PermissionsView: View {
    @Bindable var permissions: Permissions
    var onDismiss: () -> Void
    @State private var help = false
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(spacing: 0) {
                permissionRow("Microphone", symbol: "mic", status: permissions.microphone == .authorized ? "Allowed" : "Required", granted: permissions.microphone == .authorized) {
                    if permissions.microphone != .authorized { Button(permissions.microphone == .notDetermined ? "Allow…" : "Open Settings") { Task { await permissions.requestMicrophone() } } }
                }
                Divider().padding(.leading, 42)
                permissionRow("System Audio", symbol: "speaker.wave.2", status: permissions.systemLabel, granted: permissions.system == .verified) {
                    Button(permissions.system == .checking ? "Checking…" : "Check Access") { Task { await permissions.checkSystemAudio() } }.disabled(permissions.checking)
                }
            }.padding(.horizontal, 16).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
            if permissions.checking { Text("Listening for a test sound. Nothing is saved.").font(.callout).foregroundStyle(.secondary) }
            if let message = permissions.message { Text(message).font(.callout).foregroundStyle(.secondary) }
            HStack {
                Button("Open System Audio Settings") { permissions.openSettings(microphone: false); help = true }.buttonStyle(.link)
                Spacer()
                Button { help.toggle() } label: { Image(systemName: "questionmark.circle") }.buttonStyle(.plain).help("App missing from Settings?")
            }
            if help {
                HStack(spacing: 12) {
                    Image(nsImage: NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)).resizable().frame(width: 40, height: 40)
                    Text("Callkeep").font(.body.weight(.medium))
                    Spacer()
                    Image(systemName: "hand.draw").foregroundStyle(.secondary)
                }.padding(12).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
                    .onDrag { NSItemProvider(object: Bundle.main.bundleURL as NSURL) }
                    .help("Drag Callkeep into the System Audio Recording Only list")
                Text("Drag Callkeep into System Audio Recording Only, then turn it on.").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack { Spacer(); Button("Done") { onDismiss() }.keyboardShortcut(.defaultAction).disabled(permissions.checking) }
        }.padding(28).frame(width: 450)
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in permissions.refresh() }
    }
    private func permissionRow<Actions: View>(_ title: String, symbol: String, status: String, granted: Bool, @ViewBuilder actions: () -> Actions) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.title3).frame(width: 28)
            VStack(alignment: .leading, spacing: 4) { Text(title).fontWeight(.medium); Text(status).font(.caption).foregroundStyle(granted ? Color.green : Color.secondary) }
            Spacer()
            if granted { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
            actions().controlSize(.small)
        }.padding(.vertical, 16)
    }
}

@MainActor
final class PermissionsWindow {
    static let shared = PermissionsWindow()
    private var panel: NSPanel?
    func show(_ permissions: Permissions) {
        permissions.refresh()
        if let panel { panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 506, height: 340), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "Recording Access"; panel.identifier = NSUserInterfaceItemIdentifier("permissions")
        panel.isReleasedWhenClosed = false; panel.level = .floating
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.contentViewController = NSHostingController(rootView: PermissionsView(permissions: permissions, onDismiss: { [weak self] in self?.panel?.orderOut(nil) }))
        panel.center(); panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        self.panel = panel
    }
}
