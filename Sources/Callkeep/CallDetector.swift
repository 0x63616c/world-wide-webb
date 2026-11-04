import AppKit
import CoreAudio
import Darwin
import Observation
import SwiftUI
import CallkeepCore

enum CallActivityScanner {
    static func integer(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }
    static func bundleID(_ object: AudioObjectID) -> String? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }
    static func scan(running: Set<String>) throws -> [CallingApp] {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { throw CocoaError(.featureUnsupported) }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard !objects.isEmpty else { return [] }
        let status = objects.withUnsafeMutableBytes { bytes in
            AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, bytes.baseAddress!)
        }
        guard status == noErr else { throw CocoaError(.featureUnsupported) }
        var apps: [String: CallingApp] = [:]
        for object in objects {
            guard integer(object, kAudioProcessPropertyIsRunningInput) == 1 else { continue }
            let pid = pid_t(bitPattern: integer(object, kAudioProcessPropertyPID) ?? 0)
            var pathBuffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
            let pathLength = proc_pidpath(pid, &pathBuffer, UInt32(pathBuffer.count))
            let path = pathLength > 0 ? String(cString: pathBuffer) : ""
            var ids: [String] = []
            if let id = bundleID(object) { ids.append(id) }
            // Chromium and Electron capture often live in nested Helper.app bundles.
            var url = URL(fileURLWithPath: path)
            while url.path != "/", !url.path.isEmpty {
                if url.pathExtension == "app", let id = Bundle(url: url)?.bundleIdentifier { ids.append(id) }
                url.deleteLastPathComponent()
            }
            if ids.isEmpty { ids = [""] }
            for id in ids {
                if let app = CallingApp.matching(bundleID: id, executablePath: path, running: running) { apps[app.id] = app }
            }
        }
        return Array(apps.values)
    }
}

@MainActor @Observable
final class CallDetector {
    var enabled = UserDefaults.standard.object(forKey: "callReminders") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "callReminders")
            if !enabled { task?.cancel(); task = nil; hide(); filter = CallActivityFilter() }
            else { start() }
        }
    }
    private(set) var error: String?
    var isRecording: (() -> Bool)?
    var record: (() -> Void)?
    var shortcutLabel: (() -> String)?
    private var task: Task<Void, Never>?
    private var filter = CallActivityFilter()
    private var panel: NSPanel?
    private var shownID: String?
    func start() {
        guard enabled, task == nil else { return }
        task = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let running = Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
                    let apps = try await Task.detached(priority: .utility) { try CallActivityScanner.scan(running: running) }.value
                    guard let self, !Task.isCancelled, self.enabled else { return }
                    self.error = nil
                    let now = ProcessInfo.processInfo.systemUptime
                    let recording = self.isRecording?() ?? false
                    let candidate = self.filter.update(apps, now: now, recording: recording)
                    if recording || self.shownID.map({ !self.filter.isActive($0, now: now) }) == true { self.hide() }
                    if let candidate, self.panel == nil { self.show(candidate) }
                } catch {
                    guard let self else { return }
                    self.error = "Call activity is unavailable on this Mac."
                    self.hide()
                }
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }
    #if DEBUG
    func previewReminder() { show(CallingApp.supported[0]) }
    #endif
    private func hide() { panel?.close(); panel = nil; shownID = nil }
    func updatePosition() {
        guard let panel, let screen = panel.screen ?? NSScreen.main else { return }
        panel.setFrame(OverlayPosition.current.frame(for: panel.frame.size, on: screen), display: true)
    }
    private func show(_ app: CallingApp) {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let panelWidth: CGFloat = 470
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: 86), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = NSHostingView(rootView: CallReminderView(app: app, shortcut: shortcutLabel?() ?? Shortcut.default.label, record: { [weak self] in
            self?.hide(); self?.record?()
        }, dismiss: { [weak self] in self?.hide() }))
        panel.setFrame(OverlayPosition.current.frame(for: NSSize(width: panelWidth, height: 86), on: screen), display: true)
        self.panel = panel; shownID = app.id
        panel.orderFrontRegardless()
    }
}

private struct CallReminderView: View {
    let app: CallingApp
    let shortcut: String
    let record: () -> Void
    let dismiss: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "phone.fill").font(.title2).foregroundStyle(Color.accentColor)
                .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion)
            VStack(alignment: .leading, spacing: 4) {
                Text("Meeting detected").font(.headline)
                Text(app.name).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(shortcut).font(.caption).foregroundStyle(.secondary).fixedSize()
            Button("Record", action: record).buttonStyle(.borderedProminent)
            Button(action: dismiss) { Image(systemName: "xmark") }.buttonStyle(.plain).help("Dismiss for this call")
                .accessibilityLabel("Dismiss for this call")
        }.padding(18).frame(width: 470, height: 86)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }
}
