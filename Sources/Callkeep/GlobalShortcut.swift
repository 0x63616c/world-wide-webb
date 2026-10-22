import AppKit
import Carbon
import CallkeepCore

@MainActor
final class GlobalShortcut {
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    var action: (() -> Void)?
    private var localMonitor: Any?
    private var activeShortcut: Shortcut?
    init() {
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let handled = MainActor.assumeIsolated {
                guard let self, let shortcut = self.activeShortcut else { return false }
                var modifiers: UInt32 = 0
                if event.modifierFlags.contains(.command) { modifiers |= Shortcut.command }
                if event.modifierFlags.contains(.shift) { modifiers |= Shortcut.shift }
                if event.modifierFlags.contains(.option) { modifiers |= Shortcut.option }
                if event.modifierFlags.contains(.control) { modifiers |= Shortcut.control }
                guard UInt32(event.keyCode) == shortcut.keyCode, modifiers == shortcut.modifiers else { return false }
                if !event.isARepeat { self.action?() }
                return true
            }
            return handled ? nil : event
        }
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return noErr }
            let shortcut = Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue()
            Task { @MainActor in shortcut.action?() }
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &handler)
    }
    func register(shortcut: Shortcut, enabled: Bool) -> Bool {
        activeShortcut = nil
        if let reference { UnregisterEventHotKey(reference); self.reference = nil }
        guard enabled else { return true }
        let result = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, EventHotKeyID(signature: 0x434B4550, id: 1), GetApplicationEventTarget(), 0, &reference)
        if result == noErr { activeShortcut = shortcut }
        return result == noErr
    }
}
