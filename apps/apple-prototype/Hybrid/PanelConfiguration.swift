import Foundation

struct PanelConfiguration: Sendable {
    let serverURL: URL
    let cfAccessClientID: String
    let cfAccessClientSecret: String
    let alarmAPIToken: String

    init(
        info: [String: Any] = Bundle.main.infoDictionary ?? [:],
        defaults: UserDefaults = .standard,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        func value(_ key: String, _ environmentKey: String, _ plistKey: String) -> String {
            let raw = environment[environmentKey] ?? defaults.string(forKey: key) ?? (info[plistKey] as? String) ?? ""
            // An unset Xcode build setting must not become a literal credential.
            return raw.hasPrefix("$(") ? "" : raw
        }
        let server = value("serverUrl", "PANEL_SERVER_URL", "PanelServerURL")
        serverURL = KioskURLPolicy.httpURL(server) ?? URL(string: "https://app.worldwidewebb.co")!
        cfAccessClientID = value("cfAccessClientId", "PANEL_CF_ACCESS_CLIENT_ID", "PanelCFAccessClientID")
        cfAccessClientSecret = value("cfAccessClientSecret", "PANEL_CF_ACCESS_CLIENT_SECRET", "PanelCFAccessClientSecret")
        alarmAPIToken = value("alarmApiToken", "PANEL_ALARM_API_TOKEN", "PanelAlarmAPIToken")
    }

    var accessHeaders: [String: String] {
        guard !cfAccessClientID.isEmpty, !cfAccessClientSecret.isEmpty else { return [:] }
        return ["CF-Access-Client-Id": cfAccessClientID, "CF-Access-Client-Secret": cfAccessClientSecret]
    }
}
