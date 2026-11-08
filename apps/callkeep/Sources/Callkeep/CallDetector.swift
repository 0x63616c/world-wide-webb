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
    static func processObjects() throws -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { throw CocoaError(.featureUnsupported) }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard !objects.isEmpty else { return [] }
        let status = objects.withUnsafeMutableBytes { bytes in
            AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, bytes.baseAddress!)
        }
        guard status == noErr else { throw CocoaError(.featureUnsupported) }
        return Array(objects.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
    }
    static func scan(running: Set<String>) throws -> [CallingApp] {
        let objects = try processObjects()
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
        // Prefer direct app attribution when the shared helper is ambiguous.
        if apps["com.apple.FaceTime"] != nil || apps["com.apple.mobilephone"] != nil {
            apps["com.apple.avconferenced"] = nil
        }
        return Array(apps.values)
    }
}

/// Observe audio-process changes; polling remains a fallback if a listener cannot be installed.
private final class CallActivityEvents: @unchecked Sendable {
    private let queue = DispatchQueue(label: "co.calum.callkeep.call-activity-events", qos: .utility)
    private let changed: @Sendable () -> Void
    private var listListener: AudioObjectPropertyListenerBlock?
    private var listeners: [AudioObjectID: AudioObjectPropertyListenerBlock] = [:]
    init(changed: @escaping @Sendable () -> Void) { self.changed = changed }
    func start() {
        queue.async { [self] in
            var address = Self.address(kAudioHardwarePropertyProcessObjectList)
            let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
                guard let self else { return }
                self.refreshProcesses()
                self.changed()
            }
            if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, listener) == noErr {
                listListener = listener
            }
            refreshProcesses()
        }
    }
    func stop() {
        queue.async { [self] in
            var listAddress = Self.address(kAudioHardwarePropertyProcessObjectList)
            if let listListener { AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &listAddress, queue, listListener) }
            listListener = nil
            for (object, listener) in listeners {
                var address = Self.address(kAudioProcessPropertyIsRunningInput)
                AudioObjectRemovePropertyListenerBlock(object, &address, queue, listener)
            }
            listeners.removeAll()
        }
    }
    private func refreshProcesses() {
        guard let current = try? CallActivityScanner.processObjects() else { return }
        let objects = Set(current)
        for object in listeners.keys.filter({ !objects.contains($0) }) {
            guard let listener = listeners.removeValue(forKey: object) else { continue }
            var address = Self.address(kAudioProcessPropertyIsRunningInput)
            AudioObjectRemovePropertyListenerBlock(object, &address, queue, listener)
        }
        for object in objects where listeners[object] == nil {
            var address = Self.address(kAudioProcessPropertyIsRunningInput)
            guard AudioObjectHasProperty(object, &address) else { continue }
            let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.changed() }
            if AudioObjectAddPropertyListenerBlock(object, &address, queue, listener) == noErr { listeners[object] = listener }
        }
    }
    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }
}

@MainActor @Observable
final class CallDetector {
    static let delayOptions: [Double] = [0.5, 1, 2, 5, 10]
    var reminderDelay: Double = {
        let stored = UserDefaults.standard.object(forKey: "callReminderDelay") as? Double ?? 0.5
        return delayOptions.contains(stored) ? stored : 0.5
    }() {
        didSet { UserDefaults.standard.set(reminderDelay, forKey: "callReminderDelay") }
    }
    var enabled = UserDefaults.standard.object(forKey: "callReminders") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "callReminders")
            if !enabled { stop() }
            else { start() }
        }
    }
    private(set) var error: String?
    var isRecording: (() -> Bool)?
    var record: (() -> Void)?
    var shortcutLabel: (() -> String)?
    private var task: Task<Void, Never>?
    private var scanTask: Task<Void, Never>?
    private var deadlineTask: Task<Void, Never>?
    private var events: CallActivityEvents?
    private var generation = 0
    private var scanRequested = false
    private var filter = CallActivityFilter()
    private var panel: NSPanel?
    private var shownID: String?
    func start() {
        guard enabled, task == nil else { return }
        generation += 1
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.requestScan()
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            }
        }
        let observer = CallActivityEvents { [weak self] in
            Task { @MainActor [weak self] in self?.requestScan() }
        }
        events = observer; observer.start()
    }
    private func stop() {
        generation += 1
        task?.cancel(); task = nil
        scanTask?.cancel(); scanTask = nil; scanRequested = false
        deadlineTask?.cancel(); deadlineTask = nil
        events?.stop(); events = nil
        hide(); filter = CallActivityFilter()
    }
    private func requestScan() {
        guard enabled, task != nil else { return }
        if scanTask != nil { scanRequested = true; return }
        let currentGeneration = generation
        scanTask = Task { [weak self] in
            guard let self else { return }
            repeat {
                self.scanRequested = false
                await self.scanOnce(generation: currentGeneration)
            } while !Task.isCancelled && self.generation == currentGeneration && self.scanRequested
            if self.generation == currentGeneration { self.scanTask = nil }
        }
    }
    private func scanOnce(generation expected: Int) async {
        do {
            let running = Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
            let apps = try await Task.detached(priority: .utility) { try CallActivityScanner.scan(running: running) }.value
            guard !Task.isCancelled, enabled, generation == expected else { return }
            error = nil
            let now = ProcessInfo.processInfo.systemUptime
            let recording = isRecording?() ?? false
            let candidate = filter.update(apps, now: now, recording: recording, delay: reminderDelay)
            if recording || shownID.map({ !filter.isActive($0, now: now) }) == true { hide() }
            if let candidate, panel == nil { show(candidate) }
            deadlineTask?.cancel(); deadlineTask = nil
            if !recording, panel == nil, let remaining = filter.nextReminderDelay(for: apps, now: now, delay: reminderDelay) {
                deadlineTask = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(max(0.01, remaining))) } catch { return }
                    self?.requestScan()
                }
            }
        } catch {
            guard !Task.isCancelled, generation == expected else { return }
            if self.error == nil { AppLog.shared.record(.callDetectionFailed, error: error) }
            self.error = "Call activity is unavailable on this Mac."
            deadlineTask?.cancel(); deadlineTask = nil
            hide()
        }
    }
    #if DEBUG
    func previewReminder() { show(CallingApp.supported[0]) }
    #endif
    private func hide() {
        if let panel { OverlayMotion.hide(panel) }
        panel = nil; shownID = nil
    }
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
        AppLog.shared.record(.callReminderShown)
        OverlayMotion.show(panel)
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
