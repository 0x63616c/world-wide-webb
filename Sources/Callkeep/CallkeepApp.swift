import SwiftUI
import AppKit

@main
struct CallkeepApp: App {
    @State private var model = AppModel()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene {
        Window("Callkeep", id: "library") {
            LibraryView(model: model)
                .onAppear { delegate.model = model }
                .frame(minWidth: 790, minHeight: 530)
        }
        .defaultSize(width: 1040, height: 690)
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { model.showSettings() }.keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
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
        if !flag { sender.windows.first { $0.identifier?.rawValue == "library" }?.makeKeyAndOrderFront(nil) }
        return true
    }
}
