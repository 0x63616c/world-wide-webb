import SwiftUI

struct NotificationSource: Equatable {
    let name: String
    let symbol: String
}

/// A bounded overlay; only the cards intercept input, leaving the board usable.
struct NotificationBanners: View {
    @Environment(NotificationCenter.self) private var center
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { NotificationMotion.isReduced(systemReduceMotion) }
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    let source: (String) -> NotificationSource
    @State private var presenterID = UUID()

    private var pauseTimers: Bool {
        #if DEBUG
        voiceOver || ProcessInfo.processInfo.arguments.contains("-notificationHold")
        #else
        voiceOver
        #endif
    }

    private var isActivePresenter: Bool { center.isActivePresenter(presenterID) }

    private var visible: [NotificationGroup] { Array(center.bannerGroups.prefix(typeSize.isAccessibilitySize ? 1 : 3)) }

    var body: some View {
        ZStack(alignment: .top) {
            banners
                .opacity(center.historyPresented ? 0 : 1)
                .accessibilityHidden(center.historyPresented)
                .allowsHitTesting(!center.historyPresented)
            if isActivePresenter {
                if center.historyPresented {
                    NotificationHistory(source: source)
                        .transition(reduceMotion ? .opacity : .move(edge: .top))
                } else {
                    NotificationHistoryEdge()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.36, bounce: 0), value: center.historyPresented)
    }

    private var banners: some View {
        GlassEffectContainer(spacing: 8) {
            VStack(spacing: 18) {
                ForEach(visible) { group in
                    if let item = group.items.first {
                        NotificationBanner(item: item, count: group.items.count,
                            source: source(group.sourceModule), open: {
                                Task { await center.open(item.id) }
                            }, dismiss: { Task { await center.dismiss(item.id) } },
                            touch: { if center.isActivePresenter(presenterID) { center.setTouched(group.sourceModule, $0) } })
                            .id(item.id)
                            .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                    }
                }
                if let error = center.lastError {
                    Text(error).font(.callout).padding(12)
                        .background(.regularMaterial, in: .rect(cornerRadius: 16))
                        .accessibilityIdentifier("notification-error")
                }
            }
            .frame(maxWidth: typeSize.isAccessibilitySize ? 720 : 480)
            .padding(.horizontal, 24).padding(.top, 12)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(width: typeSize.isAccessibilitySize ? 768 : 528)
        .opacity(isActivePresenter ? 1 : 0)
        .accessibilityHidden(!isActivePresenter)
        .allowsHitTesting(isActivePresenter && (!visible.isEmpty || center.lastError != nil))
        .onAppear { center.registerPresenter(presenterID) }
        .onDisappear { center.unregisterPresenter(presenterID) }
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.36, bounce: 0.15), value: visible)
        .sensoryFeedback(.impact(weight: .light), trigger: center.arrivalFeedback) { _, _ in center.isActivePresenter(presenterID) }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.5), trigger: center.dismissFeedback) { _, _ in center.isActivePresenter(presenterID) }
        .sensoryFeedback(.selection, trigger: center.openFeedback) { _, _ in center.isActivePresenter(presenterID) }
        .task(id: [scenePhase == .active, pauseTimers, typeSize.isAccessibilitySize, visible.isEmpty]) {
            guard scenePhase == .active, !visible.isEmpty else { return }
            let clock = ContinuousClock()
            var previous = clock.now
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
                let instant = clock.now
                let elapsed = previous.duration(to: instant).components
                previous = instant
                guard center.isActivePresenter(presenterID) else { continue }
                center.advanceBanners(by: Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18,
                    visibleSources: Set(visible.map(\.id)), paused: pauseTimers)
            }
        }
    }
}

private struct NotificationBanner: View {
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { NotificationMotion.isReduced(systemReduceMotion) }
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var translation = CGSize.zero
    @State private var touchState = NotificationBannerTouchState()
    @GestureState private var dragging = false
    let item: NotificationItem
    let count: Int
    let source: NotificationSource
    let open: () -> Void
    let dismiss: () -> Void
    let touch: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 8) {
                        Image(systemName: source.symbol).font(.body.weight(.semibold))
                            .accessibilityHidden(true)
                        Text(source.name).font(.subheadline.weight(.semibold))
                        if count > 1 {
                            Text("+\(count - 1)").font(.caption.weight(.semibold))
                                .accessibilityLabel("\(count) notifications from \(source.name)")
                                .accessibilityIdentifier("notification-count-\(item.sourceModule)")
                        }
                        Spacer(minLength: 8)
                        Text(item.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(item.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    if !item.body.isEmpty {
                        Text(item.body).font(.body).lineLimit(typeSize.isAccessibilitySize ? 5 : 3)
                            .multilineTextAlignment(.leading)
                    }
                    if item.priority == .critical {
                        Label("Critical", systemImage: "exclamationmark.circle").font(.caption.weight(.semibold))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 18).padding(.vertical, 16)
                .contentShape(.rect)
            }
            .buttonStyle(NotificationTouchStyle(touch: {
                    touchState.pressed = $0
                    touch(touchState.pressed || touchState.dragging)
                }))
            .accessibilityIdentifier("notification-banner-\(item.sourceModule)")
            .accessibilityHint("Opens \(source.name)")
            .accessibilityAction(named: "Dismiss", dismiss)

            Button("Dismiss", systemImage: "xmark", action: dismiss)
                .labelStyle(.iconOnly).font(.caption.weight(.semibold))
                .frame(width: 44, height: 44).contentShape(.rect)
                .buttonStyle(NotificationTouchStyle(touch: {
                    touchState.pressed = $0
                    touch(touchState.pressed || touchState.dragging)
                }))
                .accessibilityIdentifier("notification-dismiss-\(item.sourceModule)")
        }
        .foregroundStyle(.primary)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
        .background {
            // Real glass surfaces form the stack; no duplicate payload or accessibility nodes.
            if count > 1 {
                Color.clear.glassEffect(.regular, in: .rect(cornerRadius: 24))
                    .padding(.horizontal, 10).offset(y: 7)
                    .accessibilityHidden(true).allowsHitTesting(false)
            }
            if count > 2 {
                Color.clear.glassEffect(.regular, in: .rect(cornerRadius: 24))
                    .padding(.horizontal, 20).offset(y: 13)
                    .accessibilityHidden(true).allowsHitTesting(false)
            }
        }
        .padding(.bottom, count > 2 ? 13 : count > 1 ? 7 : 0)
        .offset(translation)
        .highPriorityGesture(DragGesture(minimumDistance: 12)
            .updating($dragging) { _, active, _ in active = true }
            .onChanged { value in
                translation = CGSize(width: value.translation.width, height: min(0, value.translation.height))
            }
            .onEnded { value in
                if NotificationBannerGesture.dismisses(x: value.translation.width, y: value.translation.height) {
                    dismiss()
                }
                withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { translation = .zero }
            })
        .onChange(of: dragging) { _, active in
            touchState.dragging = active
            touch(touchState.pressed || active)
            // GestureState also resets on cancellation (backgrounding/system gesture).
            if !active { withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { translation = .zero } }
        }
        .onDisappear {
            touchState.pressed = false
            touchState.dragging = false
            touch(false)
        }
    }
}

private struct NotificationTouchStyle: ButtonStyle {
    let touch: (Bool) -> Void
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.onChange(of: configuration.isPressed) { _, pressed in touch(pressed) }
    }
}

enum NotificationBannerGesture {
    static func dismisses(x: Double, y: Double) -> Bool { abs(x) >= 70 || y <= -45 }
}

enum NotificationMotion {
    static func isReduced(_ system: Bool) -> Bool {
        #if DEBUG
        system || ProcessInfo.processInfo.arguments.contains("-notificationReduceMotion")
        #else
        system
        #endif
    }
}

/// Press bookkeeping must not redraw the button between touch-down and touch-up.
@MainActor private final class NotificationBannerTouchState {
    var pressed = false
    var dragging = false
}
