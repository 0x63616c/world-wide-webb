import SwiftUI

enum NotificationHistoryGesture {
    static func opens(x: Double, y: Double) -> Bool { y >= 60 && y > abs(x) }
    static func closes(x: Double, y: Double) -> Bool { y <= -60 && -y > abs(x) }
}

/// Only the top-edge strip claims the opening gesture; the board keeps its gestures.
struct NotificationHistoryEdge: View {
    @Environment(NotificationCenter.self) private var center

    var body: some View {
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
    }
}

struct NotificationHistory: View {
    @Environment(NotificationCenter.self) private var center
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { NotificationMotion.isReduced(systemReduceMotion) }
    let source: (String) -> NotificationSource
    @State private var expanded: Set<String> = []
    @State private var clearing = false

    var body: some View {
        VStack(spacing: 0) {
            header
            if let error = center.lastError ?? center.cacheError {
                Text(error).font(.callout).foregroundStyle(.secondary)
                    .padding(.horizontal, 24).padding(.bottom, 12)
                    .accessibilityIdentifier("notification-history-error")
            }
            if center.connection == .unavailable {
                Label("Offline — showing saved notifications", systemImage: "wifi.slash")
                    .font(.callout).foregroundStyle(.secondary).padding(.bottom, 12)
            }
            if center.history.isEmpty {
                ContentUnavailableView("No Notifications", systemImage: "bell.slash",
                    description: Text("New notifications will appear here."))
                    .accessibilityIdentifier("notification-history-empty")
            } else {
                List {
                    ForEach(center.groups) { group in
                        Section {
                            ForEach(expanded.contains(group.id) ? group.items : Array(group.items.prefix(1))) { item in
                                NotificationHistoryRow(item: item, source: source(group.id))
                            }
                        } header: {
                            groupHeader(group)
                        }
                    }
                }
                #if os(iOS)
                .listStyle(.insetGrouped)
                #else
                .listStyle(.inset)
                #endif
                .scrollContentBackground(.hidden)
            }
            closeHandle
        }
        .frame(maxWidth: 760, maxHeight: .infinity)
        .frame(maxWidth: .infinity)
        .background(.regularMaterial)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { center.historyPresented = false }
        .accessibilityIdentifier("notification-history")
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            Text("Notification Center").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button("Clear All") { clear() }
                .buttonStyle(.glass).disabled(clearing || center.history.isEmpty)
                .accessibilityIdentifier("notification-history-clear-all")
            Button("Close", systemImage: "xmark") { center.historyPresented = false }
                .labelStyle(.iconOnly).buttonStyle(.glass)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityIdentifier("notification-history-close")
        }
        .padding(24)
        .contentShape(.rect)
        .simultaneousGesture(closeGesture)
    }

    private func groupHeader(_ group: NotificationGroup) -> some View {
        HStack {
            Button {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                    if !expanded.insert(group.id).inserted { expanded.remove(group.id) }
                }
            } label: {
                Label("\(source(group.id).name) · \(group.items.count)", systemImage: source(group.id).symbol)
                Image(systemName: expanded.contains(group.id) ? "chevron.up" : "chevron.down")
            }
            .frame(minHeight: 44)
            .accessibilityValue(expanded.contains(group.id) ? "Expanded" : "Collapsed")
            .accessibilityHint("Shows or hides older notifications in this group")
            .accessibilityIdentifier("notification-history-group-\(group.id)")
            Spacer()
            Button("Clear All") { clear(group.id) }
                .frame(minHeight: 44).disabled(clearing)
                .accessibilityLabel("Clear all \(source(group.id).name) notifications")
                .accessibilityIdentifier("notification-history-clear-\(group.id)")
        }
        .textCase(nil)
    }

    private var closeHandle: some View {
        Button { center.historyPresented = false } label: {
            Capsule().fill(.secondary).frame(width: 48, height: 5)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close Notification Center")
        .accessibilityIdentifier("notification-history-handle")
        .simultaneousGesture(closeGesture)
    }

    // Header/handle own the closing swipe so scrolling history never dismisses it.
    private var closeGesture: some Gesture {
        DragGesture(minimumDistance: 12).onEnded { value in
            if NotificationHistoryGesture.closes(x: value.translation.width, y: value.translation.height) {
                center.historyPresented = false
            }
        }
    }

    private func clear(_ sourceModule: String? = nil) {
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
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    if item.readAt == nil {
                        Image(systemName: "circle.fill").font(.caption2).foregroundStyle(.tint)
                            .accessibilityLabel("Unread")
                    }
                    Text(item.title).font(.headline)
                    Spacer()
                    Text(item.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                }
                if !item.body.isEmpty { Text(item.body).font(.body) }
                if item.priority == .critical {
                    Label("Critical", systemImage: "exclamationmark.circle").font(.caption)
                }
            }
            .foregroundStyle(.primary)
            .multilineTextAlignment(.leading)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens \(source.name)")
        .accessibilityIdentifier("notification-history-item-\(item.id)")
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button("Clear", role: .destructive) { Task { await center.dismiss(item.id) } }
        }
        .accessibilityAction(named: "Clear") { Task { await center.dismiss(item.id) } }
    }
}
