import AppIntents

struct RecordOpeningIntent: AppIntent {
  static let title: LocalizedStringResource = LocalizedStringResource(
    "intent.recordOpening.title", defaultValue: "Record Opening")
  static let description = IntentDescription(
    LocalizedStringResource(
      "intent.recordOpening.detail", defaultValue: "Record an opening detected by your automation.")
  )
  static let supportedModes: IntentModes = [.background]
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  func perform() async throws -> some IntentResult {
    try await TrackingRuntime.shared.record(.open)
    return .result()
  }
}

struct RecordClosingIntent: AppIntent {
  static let title: LocalizedStringResource = LocalizedStringResource(
    "intent.recordClosing.title", defaultValue: "Record Closing")
  static let description = IntentDescription(
    LocalizedStringResource(
      "intent.recordClosing.detail", defaultValue: "Record a closing detected by your automation."))
  static let supportedModes: IntentModes = [.background]
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  func perform() async throws -> some IntentResult {
    try await TrackingRuntime.shared.record(.close)
    return .result()
  }
}
