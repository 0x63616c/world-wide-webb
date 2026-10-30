import Foundation
import Observation
#if os(iOS)
import ActivityKit
#endif

@MainActor @Observable final class WalkLiveActivityManager {
    private(set) var unavailableReason: String?
    private var activeID: String?
    func synchronize(walk: DogWalk?, now: Date) {
        guard walk?.id != activeID else { return }
        activeID = walk?.id
        guard let walk else { end(); return }
        start(startedAt: Date().addingTimeInterval(-walk.duration(at: now)), walkID: walk.id)
    }
    private func start(startedAt: Date, walkID: String) {
        #if os(iOS)
        guard !ProcessInfo.processInfo.arguments.contains("-snapshot") else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            unavailableReason = "Live Activities are disabled on this device."
            return
        }
        if let existing = Activity<WalkActivityAttributes>.activities.first(where: { $0.attributes.walkID == walkID }) {
            let activityID = existing.id
            Task.detached {
                if let activity = Activity<WalkActivityAttributes>.activities.first(where: { $0.id == activityID }) {
                    await activity.update(ActivityContent(state: .init(startedAt: startedAt), staleDate: nil))
                }
            }
            return
        }
        do {
            _ = try Activity.request(attributes: WalkActivityAttributes(dogName: "Zero", walkID: walkID), content: ActivityContent(state: .init(startedAt: startedAt), staleDate: nil), pushType: nil)
            unavailableReason = nil
        } catch { unavailableReason = "Live Activity unavailable. The walk is still recording in this prototype." }
        #endif
    }
    func end() {
        #if os(iOS)
        // Capture only the activities that existed when this walk stopped, so
        // an immediate new start cannot be ended by this asynchronous task.
        let endingIDs = Set(Activity<WalkActivityAttributes>.activities.map(\.id))
        Task.detached {
            for activity in Activity<WalkActivityAttributes>.activities where endingIDs.contains(activity.id) {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        #endif
    }
}
