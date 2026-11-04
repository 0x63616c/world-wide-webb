#if os(iOS)
import SwiftUI
import UIKit

/// Observe activity without covering controls or recognizing navigation gestures.
struct PanelInputObserver: UIViewRepresentable {
    let activity: () -> Void
    func makeUIView(context: Context) -> Attachment { Attachment(activity: activity) }
    func updateUIView(_ view: Attachment, context: Context) {
        view.recognizer.activity = activity
    }
    static func dismantleUIView(_ view: Attachment, coordinator: ()) { view.detach() }
    final class Attachment: UIView {
        let recognizer = PanelInputGesture()
        private weak var attachedWindow: UIWindow?
        init(activity: @escaping () -> Void) {
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            recognizer.activity = activity
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            detach()
            if let window { window.addGestureRecognizer(recognizer); attachedWindow = window }
        }
        func detach() { attachedWindow?.removeGestureRecognizer(recognizer); attachedWindow = nil }
    }
}

final class PanelInputGesture: UIGestureRecognizer, UIGestureRecognizerDelegate {
    var activity: () -> Void = {}
    private var contacts = Set<UITouch>()
    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }
    convenience init() { self.init(target: nil, action: nil) }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        activity(); contacts.formUnion(touches)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        activity()
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        activity()
        contacts.subtract(touches)
        if contacts.isEmpty { state = .failed }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .cancelled }
    override func reset() {
        contacts.removeAll()
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
#endif
