import Foundation
import Observation
import PanelKit
import UserNotifications
import SwiftUI

/// Root-owned so leaving the Timer page never stops the countdown.
@MainActor @Observable final class PanelTimerStore {
    private(set) var countdown: PanelCountdown {
        didSet { defaults.set(try? JSONEncoder().encode(countdown), forKey: Self.stateKey) }
    }
    private(set) var alertMessage: String?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let alerts = PanelTimerAlerts()
    @ObservationIgnored private var alertTask: Task<Void, Never>?
    @ObservationIgnored private var alertID: String?
    private static let stateKey = "panel.timer.countdown.v1"
    private static let alertKey = "panel.timer.alert.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        countdown = defaults.data(forKey: Self.stateKey)
            .flatMap { try? JSONDecoder().decode(PanelCountdown.self, from: $0) } ?? PanelCountdown()
        alertID = defaults.string(forKey: Self.alertKey)
        tick()
    }
    func setDuration(_ seconds: TimeInterval) { _ = countdown.setDuration(seconds) }
    func start() {
        guard countdown.phase != .running else { return }
        cancelAlert()
        countdown.start(at: .now)
        guard let deadline = countdown.deadline else { return }
        #if DEBUG
        // UI recordings run the real clock without prompting for OS notification permission.
        if ProcessInfo.processInfo.arguments.contains("-timerDisableNotifications") { return }
        #endif
        let id = UUID().uuidString // Local OS notification identifier, not a backend record.
        alertID = id
        defaults.set(id, forKey: Self.alertKey)
        alertTask = Task {
            do {
                let authorization = try await alerts.authorize()
                try Task.checkCancellation()
                guard authorization.permitted else {
                    alertMessage = "Notifications are off. The timer will finish here without a sound."
                    return
                }
                if !authorization.audible { alertMessage = "Notification sounds are off. The timer will finish silently." }
                try await alerts.schedule(id: id, deadline: deadline)
                if Task.isCancelled { alerts.cancel(id: id) }
            } catch {
                if Task.isCancelled { alerts.cancel(id: id) }
                else { alertMessage = "The timer is running, but its sound alert couldn’t be scheduled." }
            }
        }
    }
    func pause() {
        guard countdown.phase == .running else { return }
        countdown.pause(at: .now)
        if countdown.phase == .paused { cancelAlert() }
        else if countdown.phase == .finished { announceCompletion() }
    }
    func reset() {
        cancelAlert()
        countdown.reset()
    }
    func tick() {
        // Avoid publishing an unchanged state to the entire shell every second.
        if let deadline = countdown.deadline, deadline <= Date() {
            if countdown.finishIfNeeded(at: .now) { announceCompletion() }
        }
    }
    func activate() { alerts.activate(); tick() }
    private func announceCompletion() { AccessibilityNotification.Announcement("Time’s up. Your timer has finished.").post() }
    private func cancelAlert() {
        alertTask?.cancel()
        alertTask = nil
        if let alertID { alerts.cancel(id: alertID) }
        alertID = nil
        defaults.removeObject(forKey: Self.alertKey)
        alertMessage = nil
    }
}

/// The OS delivers the sound even if the app is suspended. No audio playback loop.
@MainActor private final class PanelTimerAlerts: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    func activate() { center.delegate = self }
    func authorize() async throws -> (permitted: Bool, audible: Bool) {
        var settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try await center.requestAuthorization(options: [.alert, .sound])
            settings = await center.notificationSettings()
        }
        return (settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,
            settings.authorizationStatus == .authorized && settings.soundSetting == .enabled)
    }
    func schedule(id: String, deadline: Date) async throws {
        let content = UNMutableNotificationContent()
        content.title = "Time’s up"
        content.body = "Your timer has finished."
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, deadline.timeIntervalSinceNow), repeats: false)
        try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
    func cancel(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound] }
}
