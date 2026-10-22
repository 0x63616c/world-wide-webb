import AppKit
import SwiftUI

@MainActor
final class StatusToast {
    static let shared = StatusToast()
    private var panel: NSPanel?
    private var dismissal: Task<Void, Never>?
    func show(_ message: String, recording: Bool) {
        dismissal?.cancel(); panel?.orderOut(nil)
        guard let screen = NSScreen.main else { return }
        let panel = NSPanel(contentRect: NSRect(x: screen.visibleFrame.midX - 130, y: screen.visibleFrame.maxY - 88, width: 260, height: 54), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
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
