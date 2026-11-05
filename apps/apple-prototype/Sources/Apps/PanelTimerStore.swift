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
    @ObservationIgnored private let backgroundAlertsEnabled: Bool
    @ObservationIgnored private let sound: any PanelSoundPlaying
    @ObservationIgnored private var lastSoundSecond: Int?
    var keepsScreenAwake: Bool { countdown.phase != .ready }
    @ObservationIgnored private var alertTask: Task<Void, Never>?
    @ObservationIgnored private var alertID: String?
    private static let stateKey = "panel.timer.countdown.v1"
    private static let alertKey = "panel.timer.alert.v1"

    init(defaults: UserDefaults = .standard, sound: any PanelSoundPlaying = PanelSoundBus.shared, backgroundAlertsEnabled: Bool = true) {
        self.backgroundAlertsEnabled = backgroundAlertsEnabled
        self.sound = sound
        self.defaults = defaults
        countdown = defaults.data(forKey: Self.stateKey)
            .flatMap { try? JSONDecoder().decode(PanelCountdown.self, from: $0) } ?? PanelCountdown()
        alertID = defaults.string(forKey: Self.alertKey)
    }
    func setDuration(_ seconds: TimeInterval) { _ = countdown.setDuration(seconds) }
    func start(at now: Date = .now) {
        guard countdown.phase != .running else { return }
        cancelAlert()
        countdown.start(at: now)
        lastSoundSecond = nil
        tick(at: now)
        guard backgroundAlertsEnabled, let deadline = countdown.deadline else { return }
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
                    alertMessage = "Background alerts are off. Keep the panel open to hear the timer."
                    return
                }
                if !authorization.audible { alertMessage = "Background notification sounds are off. Sound still plays while the panel is open." }
                try await alerts.schedule(id: id, deadline: deadline, audible: defaults.object(forKey: "panel.timerSound") as? Bool ?? true)
                if Task.isCancelled { alerts.cancel(id: id) }
            } catch {
                if Task.isCancelled { alerts.cancel(id: id) }
                else { alertMessage = "The timer is running. Keep the panel open to hear its alert." }
            }
        }
    }
    func pause(at now: Date = .now) {
        guard countdown.phase == .running else { return }
        countdown.pause(at: now)
        sound.stop()
        if countdown.phase == .paused { cancelAlert() }
        else if countdown.phase == .finished { announceCompletion(); lastSoundSecond = nil; tick(at: now) }
    }
    func reset() {
        cancelAlert()
        countdown.reset()
    }
    func tick(at now: Date = .now) {
        // Avoid publishing an unchanged state to the entire shell every second.
        if let deadline = countdown.deadline, deadline <= now {
            if countdown.finishIfNeeded(at: now) { announceCompletion(); lastSoundSecond = nil }
        }
        let second = Int(now.timeIntervalSince1970)
        guard lastSoundSecond != second else { return }
        let previousSecond = lastSoundSecond
        lastSoundSecond = second
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-timerDisableNotifications") { return }
        #endif
        guard defaults.object(forKey: "panel.timerSound") as? Bool ?? true else { sound.stop(); return }
        if countdown.phase == .running { sound.play(.timerTick) }
        else if countdown.phase == .finished, previousSecond == nil || second % 3 == 0 { sound.play(.timerFinished) }
    }
    func activate() { alerts.activate(); tick() }
    func deactivate() { sound.stop(); lastSoundSecond = nil }
    private func announceCompletion() { AccessibilityNotification.Announcement("Time’s up. Your timer has finished.").post() }
    private func cancelAlert() {
        sound.stop()
        lastSoundSecond = nil
        alertTask?.cancel()
        alertTask = nil
        if let alertID { alerts.cancel(id: alertID) }
        alertID = nil
        defaults.removeObject(forKey: Self.alertKey)
        alertMessage = nil
    }
}

/// OS fallback while suspended; foreground cues belong to the native sound bus.
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
    func schedule(id: String, deadline: Date, audible: Bool) async throws {
        let content = UNMutableNotificationContent()
        content.title = "Time’s up"
        content.body = "Your timer has finished."
        content.sound = audible ? .default : nil
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, deadline.timeIntervalSinceNow), repeats: false)
        try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
    func cancel(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [] }
}
