import AppKit
import SwiftUI

enum OverlayPosition: String, CaseIterable, Identifiable {
    case top, bottom
    var id: Self { self }
    var title: String { self == .top ? "Top" : "Bottom" }
    static var current: Self {
        get { Self(rawValue: UserDefaults.standard.string(forKey: "overlayPosition") ?? "") ?? .top }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "overlayPosition") }
    }
    @MainActor func frame(for size: NSSize, on screen: NSScreen) -> NSRect {
        let visible = screen.visibleFrame
        return NSRect(x: visible.midX - size.width / 2,
                      y: self == .top ? visible.maxY - size.height - 20 : visible.minY + 20,
                      width: size.width, height: size.height)
    }
}

@MainActor
final class StatusToast {
    static let shared = StatusToast()
    private var panel: NSPanel?
    private var dismissal: Task<Void, Never>?
    func updatePosition() {
        guard let panel, let screen = panel.screen ?? NSScreen.main else { return }
        panel.setFrame(OverlayPosition.current.frame(for: panel.frame.size, on: screen), display: true)
    }
    func show(_ message: String, recording: Bool) {
        dismissal?.cancel(); panel?.orderOut(nil)
        guard let screen = NSScreen.main else { return }
        let panel = NSPanel(contentRect: OverlayPosition.current.frame(for: NSSize(width: 260, height: 54), on: screen), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.level = .floating; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.ignoresMouseEvents = true
        panel.contentView = NSHostingView(rootView:
            HStack(spacing: 10) {
                Image(systemName: recording ? "record.circle.fill" : "checkmark.circle.fill").foregroundStyle(recording ? Color.red : Color.green)
                Text(message).font(.system(size: 14, weight: .medium))
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.regularMaterial, in: Capsule())
        )
        panel.orderFrontRegardless(); self.panel = panel
        dismissal = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.4))
            guard !Task.isCancelled else { return }
            self?.panel?.orderOut(nil); self?.panel = nil
        }
    }
}
