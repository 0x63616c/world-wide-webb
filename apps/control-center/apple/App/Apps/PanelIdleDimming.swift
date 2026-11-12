import SwiftUI

/// The display deadline is independent of an app's optional return-to-clock deadline.
@MainActor @Observable final class PanelIdleState {
    private(set) var dimmed = false
    private var returnedToClock = false
    private var lastActivity: TimeInterval

    init(now: TimeInterval = ProcessInfo.processInfo.systemUptime) { lastActivity = now }

    func wake(now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        lastActivity = now
        dimmed = false
        returnedToClock = false
    }

    func activity(now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard !dimmed else { return }  // Only the wake target consumes the first touch.
        lastActivity = now
        returnedToClock = false
    }

    /// Returns true once when the shell should show its clock.
    func tick(now: TimeInterval, dimAfter: Int, returnAfter: Int, dimEnabled: Bool) -> Bool {
        let elapsed = now - lastActivity
        if dimEnabled && dimAfter > 0 && elapsed >= Double(dimAfter) { dimmed = true }
        guard !returnedToClock, returnAfter > 0, elapsed >= Double(returnAfter) else { return false }
        returnedToClock = true
        return true
    }
}

/// Owns idle interaction for the whole shell, including native settings and error pages.
struct PanelIdleDimming: ViewModifier {
    let onIdle: () -> Void
    let timeout: Int
    let inhibited: Bool
    let onWake: () -> Void
    private var display = PanelDisplayPreferences()
    @State private var idle = PanelIdleState()
    @Environment(\.scenePhase) private var phase
    @Environment(PanelBrightnessPreview.self) private var brightnessPreview: PanelBrightnessPreview?

    init(onIdle: @escaping () -> Void, timeout: Int, inhibited: Bool = false, onWake: @escaping () -> Void = {}) {
        self.onIdle = onIdle
        self.timeout = timeout
        self.inhibited = inhibited
        self.onWake = onWake
    }

    private var visualOpacity: Double {
        #if targetEnvironment(simulator)
            return 1 - level
        #else
            // Hardware brightness must not be multiplied by a second dark overlay.
            return 0
        #endif
    }

    private var level: Double { brightnessPreview?.dimLevel ?? display.brightness(dimmed: idle.dimmed) }

    func body(content: Content) -> some View {
        content.allowsHitTesting(!idle.dimmed)
            .overlay { Color.black.opacity(visualOpacity).ignoresSafeArea().allowsHitTesting(false) }
            .overlay {
                if idle.dimmed {
                    Button {
                        idle.wake()
                        onWake()
                    } label: {
                        Color.clear.ignoresSafeArea().contentShape(.rect)
                    }
                    .buttonStyle(.plain).accessibilityLabel("Wake panel")
                    .accessibilityAddTraits(.isModal)
                }
            }
            .background {
                PanelScreenBrightness(level: level, active: phase == .active)
                    .allowsHitTesting(false)
                PanelInputObserver(activity: { idle.activity() })
            }
            .task(id: "\(phase)-\(timeout)-\(display.dimAfterSeconds)-\(display.idleDimming)-\(inhibited)") {
                guard phase == .active, !inhibited else { return }
                idle.wake()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                    if idle.tick(
                        now: ProcessInfo.processInfo.systemUptime, dimAfter: display.dimAfterSeconds,
                        returnAfter: timeout, dimEnabled: display.idleDimming)
                    {
                        onIdle()
                    }
                }
            }
            .onChange(of: inhibited) { _, _ in idle.wake() }
            .onChange(of: display.idleDimming) { _, _ in idle.wake() }
            .onChange(of: display.dimAfterSeconds) { _, _ in idle.wake() }
            .onChange(of: phase) { _, value in if value == .active { idle.wake() } }
    }
}
