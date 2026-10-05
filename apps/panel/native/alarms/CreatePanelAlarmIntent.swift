import AppIntents
import Foundation
import PanelAlarms

struct CreatePanelAlarmIntent: AppIntent {
  static var title: LocalizedStringResource = "Create panel alarm"
  static var description = IntentDescription("Set a Control Center alarm that rings the wall panel and turns on your lights.")
  static var openAppWhenRun = true

  @Parameter(title: "Alarm time") var time: Date
  @Parameter(title: "Label", default: "Alarm") var label: String

  static var parameterSummary: some ParameterSummary { Summary("Set \(.$label) for \(.$time)") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await PanelAlarmCoordinator.shared.create(at: time, label: label)
    return .result(dialog: "Your panel alarm is set.")
  }
}

struct PanelAlarmShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: CreatePanelAlarmIntent(), phrases: [
      "Set an alarm in \(.applicationName)",
      "Create a panel alarm with \(.applicationName)"
    ], shortTitle: "Panel alarm", systemImageName: "alarm")
  }
}
