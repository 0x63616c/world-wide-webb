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
    var visible = value
    visible.weeklyResult = .off
    visible.monthlyResult = .off
    return visible
  }

  func authorization() async -> NotificationAuthorization {
    switch await center.notificationSettings().authorizationStatus {
    case .authorized, .provisional, .ephemeral: return .allowed
    case .denied: return .denied
    default: return .unknown
    }
  }

  func applyResultPreferences(_ remote: CompetitionResultPreferences) throws {
    guard ResultNotificationChoice(rawValue: remote.weekly) != nil,
      ResultNotificationChoice(rawValue: remote.monthly) != nil
    else { throw CompetitionTransportError.invalidResponse }
    var next = preferences
    next.weeklyResult = .off
    next.monthlyResult = .off
    next.badgesEarned = remote.badge_earned ?? false
    defaults.set(try JSONEncoder().encode(next), forKey: key)
  }

  func save(
    _ requested: NotificationPreferences,
    beforePersist: ((NotificationPreferences) async throws -> Void)? = nil
  ) async throws -> NotificationPreferences {
    let previous = preferences
    var result = requested
    result.weeklyResult = .off
    result.monthlyResult = .off
    let enabling =
      (!previous.dailyLimit && requested.dailyLimit)
      || (!previous.badgesEarned && requested.badgesEarned)
    if enabling {
      if await authorization() == .unknown {
        _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
      }
      if await authorization() != .allowed {
        if !previous.dailyLimit { result.dailyLimit = false }
        if !previous.badgesEarned { result.badgesEarned = false }
      }
    }
    try await beforePersist?(result)
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
