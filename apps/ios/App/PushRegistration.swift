import Foundation
import UIKit
import UserNotifications

struct PushSigningConfiguration: Sendable {
  enum Environment: String, Codable, Sendable { case sandbox, production }
  let topic: String
  let environment: Environment
  init(bundle: Bundle = .main) throws {
    guard let topic = bundle.bundleIdentifier, !topic.isEmpty,
      let signing = bundle.object(forInfoDictionaryKey: "FoldingAPNSEnvironment") as? String
    else { throw CompetitionTransportError.unavailable }
    switch signing {
    case "development": environment = .sandbox
    case "production": environment = .production
    default: throw CompetitionTransportError.unavailable
    }
    self.topic = topic
  }
}

struct CompetitionResultPreferences: Codable, Equatable, Sendable {
  let weekly: String
  let monthly: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let home_timezone: String
  let locale: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  var badge_earned: Bool? = nil
}

/// Device-only APNs state. The backend independently derives the allowed topic/environment.
@MainActor final class PushRegistration {
  private struct Binding: Codable, Equatable {
    let participantID: String
    let deviceID: UUID
    let token: String
    let environment: PushSigningConfiguration.Environment
    let topic: String
  }
  private struct Pending: Codable {
    let operationID: UUID
    let binding: Binding
    let removing: Bool
  }
  private struct PendingPreferences: Codable {
    let operationID: UUID
    let participantID: String
    let value: CompetitionResultPreferences
  }
  private struct State: Codable {
    var token: Data?
    var registered: Binding?
    var pending: Pending?
    var preferences: PendingPreferences?
  }
  private struct Context {
    let transport: CompetitionTransport
    let participantID: String
    let deviceID: UUID
  }
  private let configuration: PushSigningConfiguration
  private let storage: CompetitionCredentialStore
  private var state: State
  private var context: Context?
  private var lastContext: Context?
  private var registeringWithOS = false
  private var updating = false
  private var desiredRevision = 0
  private var sessionRevision = UUID()
  private(set) var lastFailure: Error?
  private(set) var preferences = NotificationPreferences()
  private(set) var authorization: NotificationAuthorization = .unknown

  init(configuration: PushSigningConfiguration) throws {
    self.configuration = configuration
    storage = CompetitionCredentialStore(service: "\(configuration.topic).push.v1")
    if let data = try storage.read("state") {
      state = try JSONDecoder().decode(State.self, from: data)
    } else {
      state = State()
    }
  }

  func configure(
    transport: CompetitionTransport?, participantID: String?,
    preferences: NotificationPreferences, authorization: NotificationAuthorization
  ) async throws {
    self.preferences = preferences
    self.authorization = authorization
    if let transport, let participantID {
      context = Context(
        transport: transport, participantID: participantID, deviceID: transport.deviceID)
      lastContext = context
    } else {
      context = nil
    }
    desiredRevision += 1
    let enabled = wantsResultPush && authorization == .allowed && context != nil
    if enabled && !registeringWithOS {
      registeringWithOS = true
      UIApplication.shared.registerForRemoteNotifications()
    } else if !enabled {
      UIApplication.shared.unregisterForRemoteNotifications()
      registeringWithOS = false
    }
    try await synchronize()
  }

  /// Call before discarding the authenticated session on logout/leave/delete.
  func deactivate() async throws {
    context = nil
    desiredRevision += 1
    UIApplication.shared.unregisterForRemoteNotifications()
    registeringWithOS = false
    try await synchronize()
  }

  /// Only after the backend confirms its account/session removal also purged push bindings.
  func forgetAfterServerRemoval() throws {
    UIApplication.shared.unregisterForRemoteNotifications()
    registeringWithOS = false
    context = nil
    lastContext = nil
    sessionRevision = UUID()
    desiredRevision += 1
    state.registered = nil
    state.pending = nil
    state.preferences = nil
    try persist()
  }

  func received(token: Data) async {
    guard !token.isEmpty, token.count <= 4096 else { return }
    do {
      state.token = token
      try persist()
      desiredRevision += 1
      try await synchronize()
    } catch { lastFailure = error }
  }

  func registrationFailed(_ error: Error) {
    registeringWithOS = false
    lastFailure = error
  }

  func saveResultPreferences(
    _ requested: NotificationPreferences,
    transport: CompetitionTransport, participantID: String, homeTimezone: String,
    locale: String
  ) async throws {
    guard TimeZone(identifier: homeTimezone) != nil else {
      throw CompetitionTransportError.invalidResponse
    }
    let locale = Self.supportedLocale(locale)
    let value = CompetitionResultPreferences(
      weekly: requested.weeklyResult.rawValue,
      monthly: requested.monthlyResult.rawValue, home_timezone: homeTimezone, locale: locale,
      badge_earned: requested.badgesEarned)
    let pending: PendingPreferences
    if let previous = state.preferences, previous.participantID == participantID,
      previous.value == value
    {
      pending = previous
    } else {
      pending = PendingPreferences(operationID: UUID(), participantID: participantID, value: value)
      state.preferences = pending
      try persist()
    }
    struct Request: Encodable {
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let operation_id: String
      let preferences: CompetitionResultPreferences
    }
    struct Response: Decodable, Sendable { let preferences: CompetitionResultPreferences }
    let response: Response = try await transport.send(
      "PUT", path: "/v1/preferences",
      body: CompetitionTransport.encode(
        Request(operation_id: pending.operationID.uuidString.lowercased(), preferences: value)))
    guard response.preferences == value else { throw CompetitionTransportError.invalidResponse }
    if state.preferences?.operationID == pending.operationID {
      state.preferences = nil
      try persist()
    }
  }

  func shouldPresent(_ route: PushNotificationRoute?, identifier: String) -> Bool {
    guard authorization == .allowed else { return false }
    if identifier.hasPrefix("folding.daily-limit.") { return preferences.dailyLimit }
    guard context != nil, let route else { return false }
    if route.isBadge { return false }
    switch route.period {
    case .week: return preferences.weeklyResult != .off
    case .month: return preferences.monthlyResult != .off
    case .all: return false
    }
  }

  func acceptsBadgeNotification(_ route: PushNotificationRoute) -> Bool {
    route.isBadge && authorization == .allowed && preferences.badgesEarned
      && route.participantID == context?.participantID && context != nil
  }

  private var wantsResultPush: Bool {
    preferences.badgesEarned || preferences.weeklyResult != .off
      || preferences.monthlyResult != .off
  }
  private var desiredBinding: Binding? {
    guard wantsResultPush, authorization == .allowed, let context, let token = state.token else {
      return nil
    }
    return Binding(
      participantID: context.participantID, deviceID: context.deviceID,
      token: token.map { String(format: "%02x", $0) }.joined(),
      environment: configuration.environment, topic: configuration.topic)
  }

  private func synchronize() async throws {
    guard !updating else { return }
    updating = true
    defer { updating = false }
    while true {
      let revision = desiredRevision
      let session = sessionRevision
      let desired = desiredBinding
      let pending: Pending?
      if let desired {
        if state.registered == desired && state.pending == nil { return }
        if let existing = state.pending, !existing.removing, existing.binding == desired {
          pending = existing
        } else {
          pending = Pending(operationID: UUID(), binding: desired, removing: false)
        }
      } else if let existing = state.pending, existing.removing {
        pending = existing
      } else if let registered = state.registered ?? state.pending?.binding {
        pending = Pending(operationID: UUID(), binding: registered, removing: true)
      } else {
        return
      }
      guard let pending else { return }
      // Never use a different participant's session to clean up a previous binding.
      let sending = context?.participantID == pending.binding.participantID ? context : lastContext
      guard let sending, sending.participantID == pending.binding.participantID else {
        throw CompetitionTransportError.unauthorized
      }
      state.pending = pending
      try persist()
      let path = "/v1/push-installations/\(pending.binding.deviceID.uuidString.lowercased())"
      if pending.removing {
        struct Response: Decodable, Sendable { let registered: Bool }
        let result: Response = try await sending.transport.send(
          "DELETE", path: path,
          body: CompetitionTransport.encode([
            "operation_id": pending.operationID.uuidString.lowercased()
          ]))
        guard session == sessionRevision else { return }
        guard !result.registered else { throw CompetitionTransportError.invalidResponse }
        state.registered = nil
      } else {
        struct Response: Decodable, Sendable { let registered: Bool }
        let result: Response = try await sending.transport.send(
          "PUT", path: path,
          body: CompetitionTransport.encode([
            "operation_id": pending.operationID.uuidString.lowercased(),
            "token_hex": pending.binding.token, "environment": pending.binding.environment.rawValue,
          ]))
        guard session == sessionRevision else { return }
        guard result.registered else { throw CompetitionTransportError.invalidResponse }
        state.registered = pending.binding
      }
      state.pending = nil
      try persist()
      lastFailure = nil
      if revision == desiredRevision { return }
    }
  }

  private func persist() throws { try storage.write(JSONEncoder().encode(state), account: "state") }

  static func supportedLocale(_ identifier: String) -> String {
    let tag = identifier.replacingOccurrences(of: "_", with: "-")
    let supported = ["en", "de", "fr", "es", "es-419", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"]
    if supported.contains(tag) { return tag }
    if tag.hasPrefix("zh-Hant") || tag == "zh-TW" || tag == "zh-HK" { return "zh-Hant" }
    if tag.hasPrefix("zh") { return "zh-Hans" }
    if tag.hasPrefix("pt") { return "pt-BR" }
    if tag.hasPrefix("es-") && tag != "es-ES" { return "es-419" }
    return supported.first { tag.hasPrefix($0 + "-") } ?? "en"
  }
}
