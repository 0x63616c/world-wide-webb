import Foundation

struct NotificationPreferences: Codable, Equatable, Sendable {
  var dailyLimit = false
  var weeklyResult: ResultNotificationChoice = .off
  var monthlyResult: ResultNotificationChoice = .off
}

enum ResultNotificationChoice: String, Codable, CaseIterable, Identifiable, Sendable {
  case off, all, podium
  var id: Self { self }
  var title: String {
    switch self {
    case .off: String(localized: "notifications.off", defaultValue: "Off")
    case .all: String(localized: "notifications.all", defaultValue: "All results")
    case .podium: String(localized: "notifications.podium", defaultValue: "Podium only")
    }
  }
}

enum NotificationAuthorization { case unknown, allowed, denied }
