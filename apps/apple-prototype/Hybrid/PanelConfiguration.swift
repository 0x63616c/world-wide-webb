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
        #if DEBUG && targetEnvironment(simulator)
        // Keep an explicitly supplied local development endpoint across icon launches.
        // Fixture transports must never overwrite the developer's endpoint.
        if !ProcessInfo.processInfo.arguments.contains("-hybridFixtures"),
           let supplied = environment["PANEL_SERVER_URL"],
           let url = Self.httpURL(supplied),
           ["localhost", "127.0.0.1"].contains(url.host ?? "") {
            defaults.set(supplied, forKey: "serverUrl")
        }
        #endif
        let server = value("serverUrl", "PANEL_SERVER_URL", "PanelServerURL")
        serverURL = Self.httpURL(server) ?? URL(string: "https://app.worldwidewebb.co")!
        cfAccessClientID = value("cfAccessClientId", "PANEL_CF_ACCESS_CLIENT_ID", "PanelCFAccessClientID")
        cfAccessClientSecret = value("cfAccessClientSecret", "PANEL_CF_ACCESS_CLIENT_SECRET", "PanelCFAccessClientSecret")
        alarmAPIToken = value("alarmApiToken", "PANEL_ALARM_API_TOKEN", "PanelAlarmAPIToken")
    }

    private static func httpURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil,
              url.user == nil, url.password == nil else { return nil }
        return url
    }

    var accessHeaders: [String: String] {
        guard !cfAccessClientID.isEmpty, !cfAccessClientSecret.isEmpty else { return [:] }
        return ["CF-Access-Client-Id": cfAccessClientID, "CF-Access-Client-Secret": cfAccessClientSecret]
    }
}
