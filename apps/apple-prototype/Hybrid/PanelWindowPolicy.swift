import SwiftUI
import UIKit

/// Point dimensions of the wall panel, shared by the Mac policy and its tests.
enum PanelWindowPolicy {
    static let wallSize = CGSize(width: 1366, height: 1024)

    static func fixedSize(isiOSAppOnMac: Bool) -> CGSize? {
        isiOSAppOnMac ? wallSize : nil
    }

    @MainActor static func apply(to scene: UIWindowScene, isiOSAppOnMac: Bool) {
        guard let size = fixedSize(isiOSAppOnMac: isiOSAppOnMac),
              let restrictions = scene.sizeRestrictions else { return }
        restrictions.minimumSize = size
        restrictions.maximumSize = size
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
