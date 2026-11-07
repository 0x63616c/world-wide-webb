import SwiftUI
import PanelKit

struct NotificationSource: Equatable {
    let name: String
    let symbol: String
    let app: PanelAppDefinition?

    init(name: String, symbol: String, app: PanelAppDefinition? = nil) {
        self.name = name
        self.symbol = symbol
        self.app = app
    }
}

/// The launcher and both notification surfaces share the same app artwork.
struct NotificationSourceIcon: View {
    let source: NotificationSource
    var side: CGFloat = 38

    var body: some View {
        Group {
            if let app = source.app {
                PanelAppIcon(app: app, side: side)
            } else {
                Image(systemName: source.symbol)
                    .font(.system(size: side * 0.58, weight: .medium))
                    .foregroundStyle(.black.opacity(0.85))
                    .frame(width: side, height: side)
                    .background(.white.gradient, in: .rect(cornerRadius: side * 0.26))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Only cards and controls intercept input; the rest of the board remains usable.
struct NotificationBanners: View {
    @Environment(NotificationCenter.self) private var center
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var presenterID = UUID()
    @State private var expanded = false
    @State private var interaction = NotificationBannerInteraction()
    let source: (String) -> NotificationSource
    var initiallyExpanded = false
    var captureDrag: CGFloat = 0

    private var reduceMotion: Bool { NotificationMotion.isReduced(systemReduceMotion) }
    private var motion: Animation { reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.36, bounce: 0.12) }
    private var items: [NotificationItem] { NotificationBannerStack.ordered(center.bannerGroups) }
    private var isActivePresenter: Bool { center.isActivePresenter(presenterID) }
    private var pauseTimers: Bool {
        #if DEBUG
        voiceOver || expanded || !interaction.touching.isEmpty || ProcessInfo.processInfo.arguments.contains("-notificationHold")
        #else
        voiceOver || expanded || !interaction.touching.isEmpty
        #endif
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            banners
                .opacity(center.historyPresented ? 0 : 1)
                .accessibilityHidden(center.historyPresented)
                .allowsHitTesting(!center.historyPresented)
            if isActivePresenter {
                if center.historyPresented {
                    NotificationHistory(source: source)
                        .transition(reduceMotion ? .opacity : .move(edge: .top))
                } else { NotificationHistoryEdge() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .environment(\.colorScheme, .dark)
        .animation(motion, value: center.historyPresented)
    }

    private var banners: some View {
        GlassEffectContainer(spacing: 0) {
            VStack(alignment: .trailing, spacing: 8) {
                if expanded && items.count > 1 {
                    Button("Show less") { withAnimation(motion) { expanded = false } }
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 88, minHeight: 44)
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("notification-stack-collapse")
                }
                // Keep the first card in one place in the view tree. Replacing it
                // with a matched copy in the ScrollView also morphs its glass edge.
                if let first = items.first {
                    banner(first, count: expanded ? 1 : items.count)
                        .background(alignment: .bottom) {
                            ForEach(0..<NotificationBannerStack.peekCount(items.count), id: \.self) { index in
                                RoundedRectangle(cornerRadius: 20)
                                    .fill(.regularMaterial)
                                    .frame(height: 70)
                                    .scaleEffect(x: 1 - CGFloat(index + 1) * 0.045, y: 1, anchor: .bottom)
                                    .offset(y: CGFloat(index + 1) * 10)
                                    .brightness(-Double(index + 1) * 0.04)
                                    .zIndex(-Double(index))
                                    .accessibilityHidden(true).allowsHitTesting(false)
                            }
                            .opacity(expanded ? 0 : 1)
                        }
                        .padding(.bottom, expanded ? 0 : CGFloat(NotificationBannerStack.peekCount(items.count)) * 10)
                }
                if expanded && items.count > 1 {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(Array(items.dropFirst())) { item in banner(item, count: 1) }
                        }
                        .padding(.vertical, 2)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    .scrollClipDisabled()
                    .frame(maxHeight: 780)
                    .transition(.opacity)
                }
                if let error = center.lastError {
                    Text(error).font(.callout).padding(12)
                        .background(.regularMaterial, in: .rect(cornerRadius: 16))
                        .accessibilityIdentifier("notification-error")
                }
            }
        }
        .frame(width: typeSize.isAccessibilitySize ? 560 : 380)
        // Anchor banners at the top-right margin of their full-screen host.
        .padding(.trailing, 20).padding(.top, 20)
        .environment(\.colorScheme, .dark)
        .opacity(isActivePresenter ? 1 : 0)
        .accessibilityHidden(!isActivePresenter)
        .allowsHitTesting(isActivePresenter && (!items.isEmpty || center.lastError != nil))
        .onAppear { expanded = initiallyExpanded; center.registerPresenter(presenterID) }
        .onDisappear { center.unregisterPresenter(presenterID); interaction.touching.removeAll() }
        .onChange(of: items.count) { _, count in if count < 2 { expanded = false } }
        .animation(motion, value: items)
        .sensoryFeedback(.impact(weight: .light), trigger: center.arrivalFeedback) { _, _ in isActivePresenter }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.5), trigger: center.dismissFeedback) { _, _ in isActivePresenter }
        .sensoryFeedback(.selection, trigger: center.openFeedback) { _, _ in isActivePresenter }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            let clock = ContinuousClock()
            var previous = clock.now
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
                let instant = clock.now
                let elapsed = previous.duration(to: instant).components
                previous = instant
                guard isActivePresenter else { continue }
                center.advanceBanners(by: Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18,
                    visibleIDs: Set(items.prefix(expanded ? items.count : 1).map(\.id)), paused: pauseTimers)
            }
        }
    }

    private func banner(_ item: NotificationItem, count: Int) -> some View {
        NotificationBanner(item: item, count: count, source: source(item.sourceModule),
            captureDrag: captureDrag, open: {
                if !expanded && items.count > 1 { withAnimation(motion) { expanded = true } }
                else { Task { await center.open(item.id) } }
            }, dismiss: { center.hideBanner(item.id) }, touch: { active in
                if active { interaction.touching.insert(item.id) } else { interaction.touching.remove(item.id) }
            })
            .id(item.id)
            .transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
    }
}

private struct NotificationBanner: View {
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @State private var translation: CGFloat = 0
    @State private var leaving = false
    @State private var interaction = NotificationCardInteraction()
    @GestureState private var dragging = false
    let item: NotificationItem
    let count: Int
    let source: NotificationSource
    let captureDrag: CGFloat
    let open: () -> Void
    let dismiss: () -> Void
    let touch: (Bool) -> Void
    private var reduceMotion: Bool { NotificationMotion.isReduced(systemReduceMotion) }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                NotificationSourceIcon(source: source)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(source.name).font(.subheadline.weight(.bold)).lineLimit(1)
                        Spacer(minLength: 4)
                        if count > 1 {
                            Text("+\(count - 1)").font(.caption.weight(.semibold))
                                .accessibilityLabel("\(count) notifications")
                                .accessibilityIdentifier("notification-stack-count")
                        }
                        Text(item.createdAt, style: .relative).font(.caption2)
                            .foregroundStyle(.secondary).lineLimit(1)
                    }
                    Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if !item.body.isEmpty {
                        Text(item.body).font(.subheadline).lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .contentShape(.rect(cornerRadius: 20))
        }
        .buttonStyle(NotificationTouchStyle(touch: { pressed in
            interaction.pressed = pressed
            touch(pressed || interaction.dragging || leaving)
        }))
        .foregroundStyle(.primary)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
        .glassEffectTransition(reduceMotion ? .identity : .materialize)
        .accessibilityIdentifier("notification-banner-\(item.sourceModule)")
        .accessibilityValue(item.priority == .critical ? "Critical" : "")
        .accessibilityHint(count > 1 ? "Expands notifications" : "Opens \(source.name)")
        .accessibilityActions {
            if !item.isPersistentUpdate { Button("Dismiss", action: dismiss) }
        }
        .offset(x: translation + captureDrag)
        .opacity(leaving && reduceMotion ? 0 : 1)
        .highPriorityGesture(DragGesture(minimumDistance: 10)
            .updating($dragging) { _, active, _ in active = true }
            .onChanged { value in
                guard !leaving else { return }
                translation = NotificationBannerGesture.offset(value.translation.width)
            }
            .onEnded { value in
                guard !leaving else { return }
                if NotificationBannerGesture.dismisses(x: value.translation.width, y: value.translation.height,
                    predictedX: value.predictedEndTranslation.width) {
                    leaving = true
                    touch(true)
                    withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .easeOut(duration: 0.22)) {
                        translation = reduceMotion ? 0 : 680
                    } completion: { dismiss() }
                } else {
                    withAnimation(reduceMotion ? nil : .spring(duration: 0.3, bounce: 0.18)) { translation = 0 }
                }
            }, including: item.isPersistentUpdate ? .none : .all)
        .onChange(of: dragging) { _, active in
            interaction.dragging = active
            touch(interaction.pressed || active || leaving)
            if !active && !leaving {
                withAnimation(reduceMotion ? nil : .spring(duration: 0.3, bounce: 0.18)) { translation = 0 }
            }
        }
        .onDisappear { touch(false) }
    }
}

private struct NotificationTouchStyle: ButtonStyle {
    let touch: (Bool) -> Void
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.onChange(of: configuration.isPressed) { _, pressed in touch(pressed) }
    }
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


/// Touch bookkeeping is read by the clock, without redrawing a pressed Button.
@MainActor private final class NotificationBannerInteraction {
    var touching: Set<String> = []
}

@MainActor private final class NotificationCardInteraction {
    var pressed = false
    var dragging = false
}
