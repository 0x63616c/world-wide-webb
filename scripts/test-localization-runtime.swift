import Foundation

// Run against xcstringstool's output, not the source JSON, to exercise Foundation plural selection.
guard CommandLine.arguments.count == 2 else {
  fatalError("Usage: swift scripts/test-localization-runtime.swift <compiled catalog directory>")
}
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let todayLabels = [
  "en": "Today", "de": "Heute", "fr": "Aujourd’hui", "es": "Hoy", "es-419": "Hoy",
  "ja": "今日", "ko": "오늘", "pt-BR": "Hoje", "zh-Hans": "今天", "zh-Hant": "今天",
]
var pluralChecks = 0
for (identifier, today) in todayLabels.sorted(by: { $0.key < $1.key }) {
  guard let bundle = Bundle(url: root.appendingPathComponent("\(identifier).lproj")) else {
    fatalError("Missing compiled localization: \(identifier)")
  }
  let locale = Locale(identifier: identifier)
  func translated(_ key: String) -> String {
    let value = bundle.localizedString(forKey: key, value: nil, table: "Localizable")
    precondition(value != key, "Unresolved key: \(identifier)/\(key)")
    return value
  }
  precondition(translated("tab.today") == today, "Wrong localization: \(identifier)")
  for key in ["intent.recordOpening.title", "intent.recordClosing.title"] {
    precondition(!translated(key).isEmpty)
  }
  let pending = translated("leaderboard.pending")
  for count: Int64 in [0, 1, 2, 1_000_000] {
    let value = String(format: pending, locale: locale, arguments: [count])
    precondition(!value.contains("%") && !value.contains("#@"), "Unresolved plural: \(identifier)")
    precondition(
      value.contains(count.formatted(.number.locale(locale))), "Lost number: \(identifier)")
    if ["es", "es-419", "pt-BR"].contains(identifier) {
      if count == 1 { precondition(value == "1 pendiente" || value == "1 pendente") }
      if count == 2 { precondition(value == "2 pendientes" || value == "2 pendentes") }
    }
    pluralChecks += 1
  }
  let duration = Duration.seconds(270063).formatted(
    .units(allowed: [.days, .hours, .minutes, .seconds], width: .narrow, maximumUnitCount: 4)
      .locale(locale))
  precondition(!duration.isEmpty && !duration.contains("%"))
  let period = String(
    format: translated("leaderboard.periodTimezone"), locale: locale, arguments: ["PERIOD"])
  precondition(period == "PERIOD · UTC")
}
print(
  "Compiled localization passed: \(todayLabels.count) locales, \(pluralChecks) plural cases, text interpolation and Intent keys."
)
