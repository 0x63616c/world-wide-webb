import SwiftUI
import UIKit

/// Desktop windows resize the same shared interface; never enforce a wall-panel rectangle.
enum PanelWindowPolicy {
    static let minimumDesktopSize = CGSize(width: 360, height: 480)

    static func minimumSize(isDesktop: Bool) -> CGSize? {
        isDesktop ? minimumDesktopSize : nil
    }

    @MainActor static func apply(to scene: UIWindowScene, isDesktop: Bool) {
        guard let size = minimumSize(isDesktop: isDesktop),
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
            #if targetEnvironment(macCatalyst)
            PanelWindowPolicy.apply(to: scene, isDesktop: true)
            #else
            PanelWindowPolicy.apply(to: scene, isDesktop: ProcessInfo.processInfo.isiOSAppOnMac)
            #endif
        }
    }
}
