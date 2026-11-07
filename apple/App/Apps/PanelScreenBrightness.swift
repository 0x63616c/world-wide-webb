#if os(iOS)
    import SwiftUI
    import UIKit

    /// Keeps the original system setting for leaving Panel, never for waking within it.
    @MainActor final class PanelBrightnessLease {
        private var original: CGFloat?
        private var write: ((CGFloat) -> Void)?

        func acquire(read: () -> CGFloat, write: @escaping (CGFloat) -> Void) {
            guard original == nil else { return }
            original = read()
            self.write = write
        }

        func apply(_ level: Double) { write?(CGFloat(min(1, max(0.1, level)))) }

        func restore() {
            if let original { write?(original) }
            original = nil
            write = nil
        }
    }

    struct PanelScreenBrightness: UIViewRepresentable {
        let level: Double
        let active: Bool

        func makeUIView(context: Context) -> Attachment { Attachment() }
        func updateUIView(_ view: Attachment, context: Context) {
            view.level = level
            view.active = active
            view.apply()
        }
        static func dismantleUIView(_ view: Attachment, coordinator: ()) { view.detach() }

        final class Attachment: UIView {
            var level = 1.0
            var active = false
            private weak var attachedScreen: UIScreen?
            private let lease = PanelBrightnessLease()

            override func didMoveToWindow() {
                super.didMoveToWindow()
                apply()
            }

            func apply() {
                guard active, let screen = window?.windowScene?.screen else {
                    detach()
                    return
                }
                if attachedScreen !== screen {
                    detach()
                    attachedScreen = screen
                    lease.acquire(read: { screen.brightness }, write: { screen.brightness = $0 })
                }
                lease.apply(level)
            }

            func detach() {
                lease.restore()
                attachedScreen = nil
            }
        }
    }
#endif
