#if os(iOS)
import SwiftUI
import UIKit

/// Observe the window rather than placing an invisible hit target over controls.
struct PanelInputObserver: UIViewRepresentable {
    let activity: () -> Void
    let home: () -> Void
    func makeUIView(context: Context) -> Attachment { Attachment(activity: activity, home: home) }
    func updateUIView(_ view: Attachment, context: Context) {
        view.recognizer.activity = activity
        view.recognizer.home = home
    }
    static func dismantleUIView(_ view: Attachment, coordinator: ()) { view.detach() }
    final class Attachment: UIView {
        let recognizer = PanelInputGesture()
        private weak var attachedWindow: UIWindow?
        init(activity: @escaping () -> Void, home: @escaping () -> Void) {
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            recognizer.activity = activity; recognizer.home = home
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
    var home: () -> Void = {}
    private var contacts = Set<UITouch>()
    private var start: CGPoint?
    private var pinchSpan: CGFloat?
    private var multiple = false
    private var fired = false
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
        if contacts.count == 1 { start = contacts.first?.location(in: view) }
        if contacts.count > 1 { multiple = true }
        if contacts.count == 5 { pinchSpan = span() }
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        activity()
        if let initial = pinchSpan, Self.isHomePinch(touchCount: contacts.count, initial: initial, current: span()) { finish() }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        activity()
        if !multiple, let start, let end = touches.first?.location(in: view), let view,
           start.y > view.bounds.height - 128, end.y - start.y < -70, abs(end.x - start.x) < 180, start.y - end.y > abs(end.x - start.x) { finish() }
        contacts.subtract(touches)
        if contacts.isEmpty && !fired { state = .failed }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .cancelled }
    override func reset() {
        contacts.removeAll(); start = nil; pinchSpan = nil; multiple = false; fired = false
    }
    static func isHomePinch(touchCount: Int, initial: CGFloat, current: CGFloat) -> Bool {
        touchCount == 5 && initial > 40 && current < initial * 0.72
    }
    private func finish() {
        guard !fired else { return }
        fired = true; home(); state = .recognized
    }
    private func span() -> CGFloat {
        let points = contacts.map { $0.location(in: view) }
        guard !points.isEmpty else { return 0 }
        let centre = CGPoint(x: points.map(\.x).reduce(0, +) / CGFloat(points.count), y: points.map(\.y).reduce(0, +) / CGFloat(points.count))
        return points.map { hypot($0.x - centre.x, $0.y - centre.y) }.reduce(0, +) / CGFloat(points.count)
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
#endif
