import Foundation

/// A deadline, rather than a decrementing counter, survives navigation and suspension.
public struct PanelCountdown: Codable, Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case ready, running, paused, finished }
    public private(set) var duration: TimeInterval
    public private(set) var deadline: Date?
    private var pausedRemaining: TimeInterval?
    private var finished = false

    public init(duration: TimeInterval = 15 * 60) {
        self.duration = Self.validDuration(duration)
    }
    public var phase: Phase {
        if deadline != nil { return .running }
        if finished { return .finished }
        return pausedRemaining == nil ? .ready : .paused
    }
    public func remaining(at now: Date) -> TimeInterval {
        if let deadline { return max(0, deadline.timeIntervalSince(now)) }
        return finished ? 0 : pausedRemaining ?? duration
    }
    @discardableResult public mutating func setDuration(_ seconds: TimeInterval) -> Bool {
        guard phase == .ready || phase == .finished else { return false }
        duration = Self.validDuration(seconds)
        reset()
        return true
    }
    public mutating func start(at now: Date) {
        guard phase != .running else { return }
        deadline = now.addingTimeInterval(pausedRemaining ?? duration)
        pausedRemaining = nil
        finished = false
    }
    public mutating func pause(at now: Date) {
        guard phase == .running, !finishIfNeeded(at: now) else { return }
        pausedRemaining = remaining(at: now)
        deadline = nil
    }
    public mutating func reset() {
        deadline = nil
        pausedRemaining = nil
        finished = false
    }
    /// Consumes completion once, including after the process has been relaunched.
    @discardableResult public mutating func finishIfNeeded(at now: Date) -> Bool {
        guard let deadline, now >= deadline else { return false }
        self.deadline = nil
        pausedRemaining = nil
        finished = true
        return true
    }
    private static func validDuration(_ seconds: TimeInterval) -> TimeInterval {
        seconds.isFinite ? min(86_399, max(1, seconds.rounded())) : 900
    }
}
