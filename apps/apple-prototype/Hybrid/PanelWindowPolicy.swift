import SwiftUI
import UIKit

/// Personal Mac windows are resizable; the physical panel keeps its OS-owned geometry.
enum PanelWindowPolicy {
    static func minimumSize(isiOSAppOnMac: Bool) -> CGSize? {
        isiOSAppOnMac ? CGSize(width: 600, height: 480) : nil
    }

    @MainActor static func apply(to scene: UIWindowScene, isiOSAppOnMac: Bool) {
        guard let size = minimumSize(isiOSAppOnMac: isiOSAppOnMac),
              let restrictions = scene.sizeRestrictions else { return }
        restrictions.minimumSize = size
    }
}

/// Resolve this view's own scene after attachment, including newly connected windows.
/// Never look up a process-global screen or modify another scene.
struct PanelWindowAttachment: UIViewRepresentable {
    func makeUIView(context: Context) -> AttachmentView { AttachmentView() }
    func updateUIView(_ view: AttachmentView, context: Context) { view.applyPolicy() }

    final class AttachmentView: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            applyPolicy()
        }

        func applyPolicy() {
            guard let scene = window?.windowScene else { return }
            PanelWindowPolicy.apply(to: scene, isiOSAppOnMac: ProcessInfo.processInfo.isiOSAppOnMac)
        }
    }
}
