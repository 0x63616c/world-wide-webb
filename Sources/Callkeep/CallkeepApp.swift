import SwiftUI
import AppKit
import UserNotifications

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
        Window(AppIdentity.title, id: "library") {
            LibraryView(model: model)
                .environmentObject(updates)
                .onAppear { delegate.model = model }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in model.configureStorage() }
                .frame(minWidth: 790, minHeight: 530)
        }
        .defaultSize(width: 1040, height: 690)
        .windowStyle(.titleBar)
        .defaultLaunchBehavior(.suppressed)
        .restorationBehavior(.disabled)
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
            CallkeepMenuBarLabel(model: model, delegate: delegate)
        }
        .menuBarExtraStyle(.window)
    }
}

private struct CallkeepMenuBarLabel: View {
    let model: AppModel
    let delegate: AppDelegate
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Image(systemName: model.isRecording ? "record.circle.fill" : "waveform.circle")
            .symbolRenderingMode(.palette)
            .foregroundStyle(model.isRecording ? Color.red : Color.primary, Color.primary)
            .accessibilityLabel(model.isRecording ? "Callkeep recording" : "Callkeep")
            .onAppear {
                delegate.connect(model: model) {
                    NSApp.setActivationPolicy(.regular)
                    openWindow(id: "library")
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var model: AppModel?
    private var sleepObserver: NSObjectProtocol?
    private var openLibrary: (() -> Void)?
    private var finishedLaunching = false
    private var quietLaunch = false
    private var handledInitialPresentation = false
    #if DEBUG
    private var menuPreview: NSWindow?
    #endif
    func connect(model: AppModel, openLibrary: @escaping () -> Void) {
        self.model = model; self.openLibrary = openLibrary
        model.presentLibrary = openLibrary
        presentInitialWindowIfReady()
    }
    private func presentInitialWindowIfReady() {
        guard finishedLaunching, !handledInitialPresentation, let openLibrary else { return }
        handledInitialPresentation = true
        #if DEBUG
        if let scene = Bundle.main.object(forInfoDictionaryKey: "CallkeepScreenshotScene") as? String,
           ["menu", "menu-recording"].contains(scene), let model {
            if scene == "menu-recording" { model.configureScreenshotScene() }
            let preview = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
            preview.title = "Callkeep Menu Preview (Dev)"
            let content = NSHostingView(rootView: MenuPanel(model: model))
            preview.contentView = content
            preview.setContentSize(content.fittingSize)
            preview.center(); preview.makeKeyAndOrderFront(nil)
            menuPreview = preview
            return
        }
        #endif
        if !quietLaunch { openLibrary() }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        quietLaunch = LaunchAtLogin.shouldLaunchQuietly(NSAppleEventManager.shared().currentAppleEvent)
        #if DEBUG
        quietLaunch = quietLaunch || Bundle.main.object(forInfoDictionaryKey: "CallkeepSimulateLoginLaunch") as? Bool == true
        #endif
        if quietLaunch { NSApp.setActivationPolicy(.accessory) }
        finishedLaunching = true
        presentInitialWindowIfReady()
        AppIdentity.configureDock()
        UNUserNotificationCenter.current().delegate = self
        sleepObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.model?.stopRecording(reason: "Recording ended because your Mac went to sleep.") }
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                           withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                           withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let value = response.notification.request.content.userInfo["recordingID"] as? String, let id = UUID(uuidString: value) {
            Task { @MainActor [weak self] in self?.model?.select(id); self?.model?.presentLibrary?() }
        }
        completionHandler()
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if model?.isBusy == true { return .terminateCancel }
        model?.stopRecording(); return .terminateNow
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { openLibrary?() }
        return true
    }
}
