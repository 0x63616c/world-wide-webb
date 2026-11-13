import SwiftUI
import UIKit

enum NotificationHistoryGesture {
    static func opens(x: Double, y: Double, startY: Double = 0) -> Bool {
        (0...24).contains(startY) && y >= 60 && y > abs(x)
    }
    static func closes(x: Double, y: Double) -> Bool { y <= -60 && -y > abs(x) }
}

/// Only the top-edge strip claims the opening gesture; the board keeps its gestures.
struct NotificationHistoryEdge: View {
    @Environment(NotificationCenter.self) private var center

    var body: some View {
        NotificationEdgePan { center.historyPresented = true }
            .frame(width: 180, height: 24)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// A real edge hit region above UIKit-backed paging. Its pan never receives
/// touches inside the history List, so native row swipe actions remain intact.
private struct NotificationEdgePan: UIViewRepresentable {
    let open: () -> Void
    func makeUIView(context: Context) -> EdgeView { EdgeView(open: open) }
    func updateUIView(_ view: EdgeView, context: Context) { view.open = open }

    final class EdgeView: UIView {
        var open: () -> Void
        init(open: @escaping () -> Void) {
            self.open = open
            super.init(frame: .zero)
            backgroundColor = .clear
            addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(panEnded)))
            isAccessibilityElement = true
            accessibilityLabel = "Notification Center"
            accessibilityHint = "Pull down or activate to show notification history"
            accessibilityTraits = .button
            accessibilityIdentifier = "notification-history-edge"
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func accessibilityActivate() -> Bool {
            open()
            return true
        }
        @objc private func panEnded(_ gesture: UIPanGestureRecognizer) {
            guard gesture.state == .ended else { return }
            let translation = gesture.translation(in: self)
            if NotificationHistoryGesture.opens(x: translation.x, y: translation.y) { open() }
        }
    }
}

/// A flat inbox shares the incoming card layout and native glass surfaces.
struct NotificationHistory: View {
    @Environment(NotificationCenter.self) private var center
    @Environment(\.dynamicTypeSize) private var typeSize
    let source: (String) -> NotificationSource
    @State private var clearing = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.clear.contentShape(.rect)
                .onTapGesture { center.historyPresented = false }
                .accessibilityHidden(true)
            VStack(spacing: 12) {
                header
                    .glassEffect(.regular, in: .rect(cornerRadius: 32))
                status
                if center.history.isEmpty {
                    ContentUnavailableView("All caught up", systemImage: "checkmark")
                        .accessibilityIdentifier("notification-history-empty")
                } else {
                    historyList
                }
                closeHandle
            }
            .frame(
                maxWidth: typeSize.isAccessibilitySize ? 760 : 600,
                maxHeight: typeSize.isAccessibilitySize ? .infinity : 700
            )
            .padding(20)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
            .accessibilityAction(.escape) { center.historyPresented = false }
            .accessibilityIdentifier("notification-history")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var historyList: some View {
        List {
            ForEach(center.history) { item in
                NotificationHistoryRow(item: item, source: source(item.sourceModule))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 5, leading: 0, bottom: 5, trailing: 0))
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollBounceBehavior(.basedOnSize)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button {
                center.historyPresented = false
            } label: {
                Image(systemName: "chevron.up")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .accessibilityLabel("Close Notification Center")
            .accessibilityIdentifier("notification-history-close")
            Text("Notifications")
                .font(.title.bold()).accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
            NotificationIconButton(label: "Clear all notifications", symbol: "xmark") { clear() }
                .disabled(clearing || !center.history.contains(where: { !$0.isPersistentUpdate }))
                .accessibilityIdentifier("notification-history-clear-all")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .contentShape(.rect)
        .simultaneousGesture(closeGesture)
    }

    @ViewBuilder private var status: some View {
        if let error = center.lastError ?? center.cacheError {
            Label(error, systemImage: "exclamationmark.circle")
                .font(.callout).foregroundStyle(.secondary)
                .padding(.horizontal, 28).padding(.vertical, 12)
                .accessibilityIdentifier("notification-history-error")
        }
        if center.connection == .unavailable {
            Label("Offline", systemImage: "wifi.slash")
                .font(.callout).foregroundStyle(.secondary).padding(.vertical, 8)
        }
    }

    private var closeHandle: some View {
        Button {
            center.historyPresented = false
        } label: {
            Capsule().fill(.secondary).frame(width: 36, height: 5)
                .frame(maxWidth: .infinity, minHeight: 44).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close Notification Center")
        .accessibilityIdentifier("notification-history-handle")
        .simultaneousGesture(closeGesture)
    }

    // Closing gestures never compete with scrolling or native row swipe actions.
    private var closeGesture: some Gesture {
        DragGesture(minimumDistance: 12).onEnded { value in
            if NotificationHistoryGesture.closes(x: value.translation.width, y: value.translation.height) {
                center.historyPresented = false
            }
        }
    }

    private func clear(_ sourceModule: String? = nil) {
        guard !clearing else { return }
        clearing = true
        Task {
            await center.clear(sourceModule: sourceModule)
            clearing = false
        }
    }
}

private struct NotificationHistoryRow: View {
    @Environment(NotificationCenter.self) private var center
    let item: NotificationItem
    let source: NotificationSource

    var body: some View {
        Button {
            Task { await center.open(item.id) }
        } label: {
            NotificationCardContent(item: item, source: source)
                .glassEffect(.regular, in: .rect(cornerRadius: 26))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens \(source.name)")
        .accessibilityIdentifier("notification-history-item-\(item.id)")
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if !item.isPersistentUpdate {
                Button("Clear", systemImage: "xmark", role: .destructive) { Task { await center.dismiss(item.id) } }
                    .tint(.gray)
            }
        }
        .accessibilityActions {
            if !item.isPersistentUpdate { Button("Clear") { Task { await center.dismiss(item.id) } } }
        }
        .contextMenu {
            if !item.isPersistentUpdate {
                Button("Clear", systemImage: "xmark") { Task { await center.dismiss(item.id) } }
            }
        }
    }
}

/// Defer the first system edge swipe on every full-screen presentation.
struct NotificationHistoryAccess: ViewModifier {
    func body(content: Content) -> some View {
        content
            .defersSystemGestures(on: [.top, .bottom])
    }
}
