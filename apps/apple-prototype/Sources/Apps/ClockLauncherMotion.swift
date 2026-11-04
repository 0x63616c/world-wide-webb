import SwiftUI

/// Three real SwiftUI candidates for the clock/launcher review. The production
/// default slides the clock left; preview overrides are process-local, never saved.
enum ClockLauncherMotion: String {
    case reveal, depth, dissolve
    static var current: Self {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "-launcherTransition"), args.indices.contains(index + 1),
           let value = Self(rawValue: args[index + 1]) { return value }
        #endif
        return .reveal
    }
    var animation: Animation {
        switch self {
        case .reveal: .spring(duration: 0.55, bounce: 0.06)
        case .depth: .smooth(duration: 0.48)
        case .dissolve: .easeInOut(duration: 0.32)
        }
    }
    func clockOffset(_ progress: CGFloat, width: CGFloat) -> CGFloat {
        self == .reveal ? -progress * (width + 24) : 0
    }
    func clockScale(_ progress: CGFloat) -> CGFloat {
        self == .depth ? 1 + progress * 0.06 : 1
    }
    func clockOpacity(_ progress: CGFloat) -> Double {
        self == .reveal ? 1 : Double(1 - progress)
    }
    func launcherScale(_ progress: CGFloat) -> CGFloat {
        switch self {
        case .reveal: 0.96 + progress * 0.04
        case .depth: 0.90 + progress * 0.10
        case .dissolve: 1
        }
    }
}
