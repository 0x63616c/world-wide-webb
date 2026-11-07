import Foundation
import UserNotifications

@MainActor final class NotificationSettingsStore {
  private let defaults: UserDefaults
  private let center = UNUserNotificationCenter.current()
  private let key = "folding.notifications.v1"

  init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  var preferences: NotificationPreferences {
    guard let data = defaults.data(forKey: key),
      let value = try? JSONDecoder().decode(NotificationPreferences.self, from: data)
    else { return NotificationPreferences() }
    return value
  }

  func authorization() async -> NotificationAuthorization {
    switch await center.notificationSettings().authorizationStatus {
    case .authorized, .provisional, .ephemeral: return .allowed
    case .denied: return .denied
    default: return .unknown
    }
  }

  func save(_ requested: NotificationPreferences) async throws -> NotificationPreferences {
    let previous = preferences
    var result = requested
    let enabling =
      (!previous.dailyLimit && requested.dailyLimit)
      || (previous.weeklyResult == .off && requested.weeklyResult != .off)
      || (previous.monthlyResult == .off && requested.monthlyResult != .off)
    if enabling {
      if await authorization() == .unknown {
        _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
      }
      if await authorization() != .allowed {
        if !previous.dailyLimit { result.dailyLimit = false }
        if previous.weeklyResult == .off { result.weeklyResult = .off }
        if previous.monthlyResult == .off { result.monthlyResult = .off }
      }
    }
    defaults.set(try JSONEncoder().encode(result), forKey: key)
    if !result.dailyLimit {
      let pending = await center.pendingNotificationRequests()
      center.removePendingNotificationRequests(
        withIdentifiers:
          pending.filter { $0.identifier.hasPrefix("folding.daily-limit.") }.map(\.identifier))
    }
    return result
  }
}
