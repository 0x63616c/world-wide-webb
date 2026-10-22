import SwiftUI
import AppKit
import Carbon
import CallkeepCore

struct ShortcutRecorder: NSViewRepresentable {
    let shortcut: Shortcut
    let onChange: (Shortcut) -> Void
    let onCaptureChanged: (Bool) -> Void
    func makeNSView(context: Context) -> ShortcutField { let field = ShortcutField(); field.onChange = onChange; field.onCaptureChanged = onCaptureChanged; return field }
    func updateNSView(_ view: ShortcutField, context: Context) { view.shortcut = shortcut; view.onChange = onChange; view.onCaptureChanged = onCaptureChanged; view.updateTitle() }
}

final class ShortcutField: NSButton {
    var shortcut = Shortcut.default
    var onChange: ((Shortcut) -> Void)?
    var onCaptureChanged: ((Bool) -> Void)?
    private var listening = false
    override var acceptsFirstResponder: Bool { true }
    init() {
        super.init(frame: .zero)
        bezelStyle = .rounded; font = .monospacedSystemFont(ofSize: 13, weight: .medium)
        target = self; action = #selector(begin)
        setAccessibilityLabel("Recording shortcut")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func updateTitle() { title = listening ? "Press shortcut…" : shortcut.label; toolTip = "Click to change shortcut" }
    @objc private func begin() { listening = true; onCaptureChanged?(true); window?.makeFirstResponder(self); updateTitle() }
    override func resignFirstResponder() -> Bool { listening = false; onCaptureChanged?(false); updateTitle(); return true }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard listening else { return super.performKeyEquivalent(with: event) }
        keyDown(with: event); return true
    }
    override func keyDown(with event: NSEvent) {
        guard listening else { super.keyDown(with: event); return }
        if event.keyCode == UInt16(kVK_Escape) { listening = false; onCaptureChanged?(false); updateTitle(); return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var modifiers: UInt32 = 0
        if flags.contains(.command) { modifiers |= Shortcut.command }
        if flags.contains(.shift) { modifiers |= Shortcut.shift }
        if flags.contains(.option) { modifiers |= Shortcut.option }
        if flags.contains(.control) { modifiers |= Shortcut.control }
        let special: [UInt16: String] = [36: "↩", 48: "⇥", 49: "Space", 51: "⌫", 117: "⌦", 123: "←", 124: "→", 125: "↓", 126: "↑"]
        // Strip modifiers when deriving the key label so Option doesn't turn R into ®.
        let plain = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: event.timestamp, windowNumber: event.windowNumber, context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: event.keyCode)
        let key = special[event.keyCode] ?? Self.keyLabel(event.keyCode) ?? plain?.charactersIgnoringModifiers?.uppercased() ?? event.charactersIgnoringModifiers?.uppercased() ?? ""
        let value = Shortcut(keyCode: UInt32(event.keyCode), modifiers: modifiers, key: key)
        guard value.isValid else { NSSound.beep(); return }
        onChange?(value); listening = false; onCaptureChanged?(false); updateTitle()
    }
    private static func keyLabel(_ code: UInt16) -> String? {
        let keys: [UInt16: String] = [0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",15:"R",16:"Y",17:"T",18:"1",19:"2",20:"3",21:"4",22:"6",23:"5",24:"=",25:"9",26:"7",27:"-",28:"8",29:"0",30:"]",31:"O",32:"U",33:"[",34:"I",35:"P",37:"L",38:"J",39:"'",40:"K",41:";",42:"\\",43:",",44:"/",45:"N",46:"M",47:".",50:"`",122:"F1",120:"F2",99:"F3",118:"F4",96:"F5",97:"F6",98:"F7",100:"F8",101:"F9",109:"F10",103:"F11",111:"F12"]
        return keys[code]
    }
}
