import ExpoModulesCore

public final class PanelAlarmsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PanelAlarms")
    AsyncFunction("configure") { (url: String, token: String, clientID: String, clientSecret: String) in
      try await PanelAlarmCoordinator.shared.configure(url: url, token: token, clientID: clientID, clientSecret: clientSecret)
    }
    AsyncFunction("syncNextAlarm") { (json: String) in
      try await PanelAlarmCoordinator.shared.sync(json: json)
    }
    AsyncFunction("refresh") {
      try await PanelAlarmCoordinator.shared.refresh()
    }
  }
}
