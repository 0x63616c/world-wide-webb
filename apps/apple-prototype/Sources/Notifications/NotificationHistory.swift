import SwiftUI
#if os(iOS)
import UIKit
#endif

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
        #if os(iOS)
        NotificationEdgePan { center.historyPresented = true }
            .frame(height: 24)
        #else
        Color.clear
            .frame(height: 24)
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 12).onEnded { value in
                if NotificationHistoryGesture.opens(x: value.translation.width, y: value.translation.height) {
                    center.historyPresented = true
                }
            })
            .accessibilityElement()
            .accessibilityLabel("Notification Center")
            .accessibilityHint("Pull down or activate to show notification history")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { center.historyPresented = true }
            .accessibilityIdentifier("notification-history-edge")
        #endif
    }
}

#if os(iOS)
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
        override func accessibilityActivate() -> Bool { open(); return true }
        @objc private func panEnded(_ gesture: UIPanGestureRecognizer) {
            guard gesture.state == .ended else { return }
            let translation = gesture.translation(in: self)
            if NotificationHistoryGesture.opens(x: translation.x, y: translation.y) { open() }
        }
    }
}
#endif

/// A floating inbox keeps the current app in view. Glass is reserved for
/// navigation; a neutral reading surface keeps colorful wallpapers out of text.
struct NotificationHistory: View {
    @Environment(NotificationCenter.self) private var center
    @Environment(\.dynamicTypeSize) private var typeSize
    let source: (String) -> NotificationSource
    @State private var expanded: Set<String> = []
    @State private var clearing = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.clear.contentShape(.rect)
                .onTapGesture { center.historyPresented = false }
                .accessibilityHidden(true)
            VStack(spacing: 12) {
                header
                    .glassEffect(.regular, in: .rect(cornerRadius: 32))
                VStack(spacing: 0) {
                    status
                    if center.history.isEmpty {
                        ContentUnavailableView("All caught up", systemImage: "checkmark")
                            .accessibilityIdentifier("notification-history-empty")
                    } else {
                        historyList
                    }
                    closeHandle
                }
                .background(.background, in: .rect(cornerRadius: 28))
                .clipShape(.rect(cornerRadius: 28))
            }
            .frame(maxWidth: typeSize.isAccessibilitySize ? 760 : 600,
                   maxHeight: typeSize.isAccessibilitySize ? .infinity : 700)
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
            ForEach(center.groups) { group in
                Section {
                    ForEach(expanded.contains(group.id) ? group.items : Array(group.items.prefix(1))) { item in
                        NotificationHistoryRow(item: item, source: source(group.id))
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    }
                } header: {
                    groupHeader(group)
                }
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        .listSectionSpacing(20)
        #else
        .listStyle(.inset)
        #endif
        .scrollContentBackground(.hidden)
        .scrollBounceBehavior(.basedOnSize)
        .animation(.snappy(duration: 0.25), value: expanded)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { center.historyPresented = false } label: {
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

    private func groupHeader(_ group: NotificationGroup) -> some View {
        let identity = source(group.id)
        let isExpanded = expanded.contains(group.id)
        return HStack(spacing: 8) {
            if group.items.count > 1 {
                Button {
                    if !expanded.insert(group.id).inserted { expanded.remove(group.id) }
                } label: {
                    groupLabel(group, identity: identity, isExpanded: isExpanded)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(identity.name), \(group.items.count) notifications")
                .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
                .accessibilityHint("Shows or hides older notifications")
                .accessibilityIdentifier("notification-history-group-\(group.id)")
            } else {
                groupLabel(group, identity: identity, isExpanded: false)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("notification-history-group-\(group.id)")
            }
            NotificationIconButton(label: "Clear all \(identity.name) notifications", symbol: "xmark") { clear(group.id) }
                .disabled(clearing || !group.items.contains(where: { !$0.isPersistentUpdate }))
                .accessibilityIdentifier("notification-history-clear-\(group.id)")
        }
        .textCase(nil)
        .padding(.bottom, 4)
    }

    private func groupLabel(_ group: NotificationGroup, identity: NotificationSource, isExpanded: Bool) -> some View {
        HStack(spacing: 12) {
            NotificationSourceIcon(source: identity, side: 32)
            Text(identity.name).font(.headline).foregroundStyle(Color.primary)
            if group.items.count > 1 {
                Text(group.items.count, format: .number)
                    .font(.subheadline.monospacedDigit()).foregroundStyle(Color.secondary)
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption.weight(.semibold)).foregroundStyle(Color.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44).contentShape(.rect)
    }

    private var closeHandle: some View {
        Button { center.historyPresented = false } label: {
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
            NotificationMessage(item: item)
                .padding(.vertical, 2)
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
            #if os(iOS)
            .defersSystemGestures(on: [.top, .bottom])
            #endif
    }
}
