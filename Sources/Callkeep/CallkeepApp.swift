import SwiftUI
import AppKit

@main
struct CallkeepApp: App {
    @State private var model: AppModel
    @StateObject private var updates: AppUpdater
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    init() {
        let model = AppModel()
        _model = State(initialValue: model)
        _updates = StateObject(wrappedValue: AppUpdater(model: model))
    }
    var body: some Scene {
        Window("Callkeep", id: "library") {
            LibraryView(model: model)
                .onAppear { delegate.model = model }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in model.configureStorage() }
                .frame(minWidth: 790, minHeight: 530)
        }
        .defaultSize(width: 1040, height: 690)
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") { updates.checkForUpdates() }
                    .disabled(!updates.canCheckForUpdates || model.isRecording || model.isBusy)
            }
            CommandGroup(replacing: .sidebar) {
                Button("Toggle Sidebar") {
                    NSApp.sendAction(#selector(NSSplitViewController.toggleSidebar(_:)), to: nil, from: nil)
                }.keyboardShortcut("b", modifiers: .command)
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { model.showSettings() }.keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
                Button("Import Recordings…") { model.importRecordings() }
                    .keyboardShortcut("i", modifiers: [.command, .shift])
                    .disabled(model.isBusy || model.isRecording)
                Button(model.isRecording ? "Stop Recording" : "New Recording") { model.toggleRecording() }.keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }
        MenuBarExtra {
            MenuPanel(model: model).onAppear { delegate.model = model }
        } label: {
            Image(systemName: model.isRecording ? "record.circle.fill" : "waveform.circle")
                .symbolRenderingMode(.palette)
                .foregroundStyle(model.isRecording ? Color.red : Color.primary, Color.primary)
                .accessibilityLabel(model.isRecording ? "Callkeep recording" : "Callkeep")
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?
    private var sleepObserver: NSObjectProtocol?
    func applicationDidFinishLaunching(_ notification: Notification) {
        sleepObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.model?.stopRecording(reason: "Recording ended because your Mac went to sleep.") }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if model?.isBusy == true { return .terminateCancel }
        model?.stopRecording(); return .terminateNow
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { model?.presentLibrary?() }
        return true
    }
}
