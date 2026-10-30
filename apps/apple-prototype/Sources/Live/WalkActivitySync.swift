import Foundation
import Observation
#if os(iOS)
import ActivityKit
import UIKit
#endif

enum WalkActivityState: Equatable, Sendable {
    case unknown
    case idle
    /// The server start projected onto the device clock for ActivityKit's system-rendered timer.
    case walking(id: String, startedAt: Date)
}

@MainActor protocol WalkActivityDriving {
    func reconcile(_ state: WalkActivityState) async throws
}

/// Retain alongside LiveWalkProvider, including while the scene is inactive.
/// A foreground poll discovers iPad starts. Background push-to-start/updates need APNs + backend support.
@MainActor @Observable final class WalkActivitySync {
    private(set) var unavailableReason: String?
    @ObservationIgnored private let provider: LiveWalkProvider
    @ObservationIgnored private let driver: any WalkActivityDriving
    @ObservationIgnored private var desired: WalkActivityState = .unknown
    @ObservationIgnored private var applied: WalkActivityState = .unknown
    @ObservationIgnored private var task: Task<Void, Never>?

    init(provider: LiveWalkProvider, driver: any WalkActivityDriving = SystemWalkActivityDriver()) {
        self.provider = provider
        self.driver = driver
        observe()
    }

    deinit { task?.cancel() }

    private func observe() {
        desired = withObservationTracking {
            _ = provider.lastSyncedAt // Retry a previously unavailable activity on the next successful refresh.
            if let walk = provider.activeWalk {
                return .walking(id: walk.id, startedAt: walk.startedAt.addingTimeInterval(-provider.serverTimeOffset))
            }
            return provider.hasLoadedState || provider.hasAttemptedMutation ? .idle : .unknown
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observe() }
        }
        guard desired != .unknown, task == nil, desired != applied else { return }
        task = Task { [weak self, driver] in
            while let next = self?.desired, next != .unknown, next != self?.applied {
                do {
                    try await driver.reconcile(next)
                    guard !Task.isCancelled else { return }
                    self?.applied = next
                    self?.unavailableReason = nil
                } catch {
                    if self?.desired != next { continue }
                    self?.unavailableReason = "Live Activity unavailable. The walk is still synced."
                    break
                }
            }
            self?.task = nil
        }
    }
}

@MainActor private final class SystemWalkActivityDriver: WalkActivityDriving {
    func reconcile(_ state: WalkActivityState) async throws {
        #if os(iOS)
        guard UIDevice.current.userInterfaceIdiom == .phone,
              !ProcessInfo.processInfo.arguments.contains("-snapshot"), state != .unknown else { return }
        let walkID: String?
        if case .walking(let id, _) = state { walkID = id } else { walkID = nil }
        // Adopt an existing activity on relaunch; clean up orphaned/duplicate activities first.
        let keep = Activity<WalkActivityAttributes>.activities.first { $0.attributes.walkID == walkID }
        for activity in Activity<WalkActivityAttributes>.activities where activity.id != keep?.id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        guard case .walking(let id, let startedAt) = state else { return }
        let content = ActivityContent(state: WalkActivityAttributes.ContentState(startedAt: startedAt), staleDate: nil)
        if let activity = Activity<WalkActivityAttributes>.activities.first(where: { $0.attributes.walkID == id }) {
            if activity.content.state.startedAt != startedAt { await activity.update(content) }
        } else {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw ActivityFailure.disabled }
            _ = try Activity.request(attributes: WalkActivityAttributes(dogName: "Zero", walkID: id),
                                     content: content, pushType: nil)
        }
        #endif
    }

    private enum ActivityFailure: Error { case disabled }
}
