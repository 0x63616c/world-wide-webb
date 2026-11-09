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
    private var keyHeld = false
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
        var events = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))
        ]
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let context, let event else { return noErr }
            let shortcut = Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue()
            let released = GetEventKind(event) == UInt32(kEventHotKeyReleased)
            Task { @MainActor in
                if released { shortcut.keyHeld = false }
                else if !shortcut.keyHeld, shortcut.activeShortcut != nil {
                    shortcut.keyHeld = true
                    shortcut.action?()
                }
            }
            return noErr
        }, events.count, &events, Unmanaged.passUnretained(self).toOpaque(), &handler)
    }
    func register(shortcut: Shortcut, enabled: Bool) -> Bool {
        activeShortcut = nil; keyHeld = false
        if let reference { UnregisterEventHotKey(reference); self.reference = nil }
        guard enabled else { return true }
        let result = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, EventHotKeyID(signature: 0x434B4550, id: 1), GetApplicationEventTarget(), 0, &reference)
        if result == noErr { activeShortcut = shortcut }
        return result == noErr
    }
}
