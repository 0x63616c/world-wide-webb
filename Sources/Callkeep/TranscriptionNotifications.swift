import AppKit
import Observation
import UserNotifications

@MainActor @Observable
final class TranscriptionNotifications {
    private(set) var denied = false
    private var authorization: Task<Bool, Never>?
    private func ensureAuthorized() async -> Bool {
        if let authorization { return await authorization.value }
        let task = Task { @MainActor in
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            switch settings.authorizationStatus {
            case .authorized, .provisional: return true
            case .notDetermined: return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            default: return false
            }
        }
        authorization = task
        let allowed = await task.value
        denied = !allowed; authorization = nil
        return allowed
    }
    func requestIfNeeded() { Task { _ = await ensureAuthorized() } }
    func completed(recordingID: UUID) {
        Task {
            guard await ensureAuthorized() else { return }
            let content = UNMutableNotificationContent()
            content.title = "Transcript ready"
            content.body = "Your recording has been transcribed."
            content.sound = .default
            content.userInfo = ["recordingID": recordingID.uuidString]
            try? await UNUserNotificationCenter.current().add(UNNotificationRequest(
                identifier: "transcript-" + UUID().uuidString, content: content, trigger: nil))
        }
    }
}
