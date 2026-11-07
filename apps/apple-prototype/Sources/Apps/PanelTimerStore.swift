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
    var openRequested = false
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let alerts = PanelTimerAlerts.shared
    @ObservationIgnored private let backgroundAlertsEnabled: Bool
    @ObservationIgnored private let sound: any PanelSoundPlaying
    @ObservationIgnored private var nextAlarmCue: Date?
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
        guard let deadline = countdown.deadline, now < deadline else { return }
        countdown.pause(at: now)
        cancelAlert()
    }
    func reset() {
        cancelAlert()
        countdown.reset()
    }
    @discardableResult func tick(at now: Date = .now) -> Bool {
        // Avoid publishing an unchanged state to the entire shell every second.
        var completed = false
        if let deadline = countdown.deadline, deadline <= now {
            completed = countdown.finishIfNeeded(at: now)
            if completed { announceCompletion() }
        }
        if countdown.phase == .finished { ring(at: now) }
        return completed
    }
    private func ring(at now: Date) {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-timerDisableNotifications") { return }
        #endif
        guard defaults.object(forKey: "panel.timerSound") as? Bool ?? true else { sound.stop(); return }
        guard nextAlarmCue.map({ now >= $0 }) ?? true else { return }
        nextAlarmCue = now.addingTimeInterval(3)
        sound.play(.timerFinished)
    }
    func run(while scenePhase: ScenePhase, onCompletion: (() -> Void)? = nil) async {
        guard scenePhase == .active else {
            if nextAlarmCue != nil { sound.stop(); nextAlarmCue = nil }
            return
        }
        alerts.activate()
        // A deadline reached while suspended already has a system notification.
        tick()
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            if tick(), let onCompletion {
                alertTask?.cancel()
                alertTask = nil
                if let alertID { alerts.cancel(id: alertID) }
                onCompletion()
            }
        }
    }
    func matchesNotification(_ id: String?) -> Bool { id != nil && id == alertID }
    private func announceCompletion() { AccessibilityNotification.Announcement("Time’s up. Your timer has finished.").post() }
    private func cancelAlert() {
        if countdown.phase == .finished { sound.stop() }
        nextAlarmCue = nil
        alertTask?.cancel()
        alertTask = nil
        if let alertID { alerts.cancel(id: alertID) }
        alertID = nil
        defaults.removeObject(forKey: Self.alertKey)
        alertMessage = nil
    }
}

/// System delivery persists across suspension. The sound bus owns foreground audio.
@MainActor @Observable final class PanelTimerAlerts: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PanelTimerAlerts()
    nonisolated private static let thread = "panel.timer"
    private let center = UNUserNotificationCenter.current()
    private(set) var openedTimerID: String?

    func clearOpenedTimer() { openedTimerID = nil }
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
        content.threadIdentifier = Self.thread
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, deadline.timeIntervalSinceNow), repeats: false)
        try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
    func cancel(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
    }
    // With the delegate installed, the system does not present a foreground
    // alert. Panel posts its own banner; the OS still handles background delivery.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        let request = response.notification.request
        let id = response.actionIdentifier == UNNotificationDefaultActionIdentifier
            && request.content.threadIdentifier == Self.thread ? request.identifier : nil
        // UIKit finishes the foreground transition from this completion handler.
        Task { @MainActor in
            if let id { openedTimerID = id }
            completionHandler()
        }
    }
}
