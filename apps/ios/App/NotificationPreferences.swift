import Foundation

struct NotificationPreferences: Codable, Equatable, Sendable {
  var dailyLimit = false
  var weeklyResult: ResultNotificationChoice = .off
  var monthlyResult: ResultNotificationChoice = .off
  var badgesEarned = false
  init() {}
  enum CodingKeys: String, CodingKey { case dailyLimit, weeklyResult, monthlyResult, badgesEarned }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    dailyLimit = try values.decode(Bool.self, forKey: .dailyLimit)
    weeklyResult = try values.decode(ResultNotificationChoice.self, forKey: .weeklyResult)
    monthlyResult = try values.decode(ResultNotificationChoice.self, forKey: .monthlyResult)
    badgesEarned = try values.decodeIfPresent(Bool.self, forKey: .badgesEarned) ?? false
  }
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
