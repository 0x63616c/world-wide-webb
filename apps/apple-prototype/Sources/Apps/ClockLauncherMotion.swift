import SwiftUI

/// Surface motion for opening app destinations. The clock itself stays fixed
/// beneath the launcher glass; preview overrides are process-local, never saved.
enum ClockLauncherMotion: String {
    case swipePop, depth, dissolve
    static var current: Self {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "-launcherTransition"), args.indices.contains(index + 1),
           let value = Self(rawValue: args[index + 1] == "reveal" ? "swipePop" : args[index + 1]) { return value }
        #endif
        return .swipePop
    }
    var animation: Animation {
        switch self {
        case .swipePop: .spring(duration: 0.55, bounce: 0.06)
        case .depth: .smooth(duration: 0.48)
        case .dissolve: .easeInOut(duration: 0.32)
        }
    }
    func clockOffset(_ progress: CGFloat, width: CGFloat) -> CGFloat {
        self == .swipePop ? -progress * (width + 24) : 0
    }
    func clockScale(_ progress: CGFloat) -> CGFloat {
        switch self {
        case .swipePop: 1 - progress * 0.04
        case .depth: 1 + progress * 0.06
        case .dissolve: 1
        }
    }
    func launcherOffset(_ progress: CGFloat, width: CGFloat) -> CGFloat {
        self == .swipePop ? (1 - progress) * (width + 24) : 0
    }
    func clockOpacity(_ progress: CGFloat) -> Double {
        self == .swipePop ? 1 : Double(1 - progress)
    }
    func launcherScale(_ progress: CGFloat) -> CGFloat {
        switch self {
        case .swipePop: 0.96 + progress * 0.04
        case .depth: 0.90 + progress * 0.10
        case .dissolve: 1
        }
    }
    /// App entry uses the same incoming surface as the launcher; removal reverses it.
    func incomingTransition(width: CGFloat) -> AnyTransition {
        .modifier(
            active: LauncherSurfaceMotion(motion: self, progress: 0, width: width, incoming: true),
            identity: LauncherSurfaceMotion(motion: self, progress: 1, width: width, incoming: true)
        )
    }
}

/// Geometry for the launcher → app surface handoff.
struct LauncherSurfaceMotion: ViewModifier {
    let motion: ClockLauncherMotion
    let progress: CGFloat
    let width: CGFloat
    let incoming: Bool

    func body(content: Content) -> some View {
        content
            .scaleEffect(incoming ? motion.launcherScale(progress) : motion.clockScale(progress))
            .offset(x: incoming ? motion.launcherOffset(progress, width: width) : motion.clockOffset(progress, width: width))
            .opacity(motion == .swipePop ? 1 : Double(incoming ? progress : 1 - progress))
    }
}
