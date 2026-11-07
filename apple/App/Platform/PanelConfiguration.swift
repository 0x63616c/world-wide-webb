import Foundation
import PanelKit

struct PanelConfiguration: Sendable {
    let serverURL: URL
    let cfAccessClientID: String
    let cfAccessClientSecret: String
    let apiToken: String
    var api: PanelKit.PanelConfiguration {
        PanelKit.PanelConfiguration(
            baseURL: serverURL,
            accessClientID: cfAccessClientID.isEmpty ? nil : cfAccessClientID,
            accessClientSecret: cfAccessClientSecret.isEmpty ? nil : cfAccessClientSecret,
            apiToken: apiToken.isEmpty ? nil : apiToken)
    }
    init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        enrollment: PanelEnrollment? = PanelEnrollment.load()
    ) {
        let enrolled = enrollment
        #if DEBUG
            let override = environment["PANEL_SERVER_URL"].flatMap(URL.init(string:))
                .flatMap { PanelKit.PanelConfiguration(baseURL: $0) }
            let development = override.flatMap { configuration in
                PanelKit.PanelConfiguration.fromEnvironment([
                    "WWW_PANEL_API_URL": configuration.baseURL.absoluteString,
                    "WWW_API_TOKEN": environment["WWW_API_TOKEN"] ?? "",
                    "WWW_CF_ACCESS_CLIENT_ID": environment["WWW_CF_ACCESS_CLIENT_ID"] ?? "",
                    "WWW_CF_ACCESS_CLIENT_SECRET": environment["WWW_CF_ACCESS_CLIENT_SECRET"] ?? "",
                ])
            }
        #else
            let development: PanelKit.PanelConfiguration? = nil
        #endif
        let connection = development ?? enrolled?.configuration
        serverURL = connection?.baseURL ?? URL(string: "https://api.worldwidewebb.co")!
        cfAccessClientID = connection?.accessClientID ?? ""
        cfAccessClientSecret = connection?.accessClientSecret ?? ""
        apiToken = connection?.apiToken ?? ""
    }
    var accessHeaders: [String: String] {
        guard !cfAccessClientID.isEmpty, !cfAccessClientSecret.isEmpty else { return [:] }
        return ["CF-Access-Client-Id": cfAccessClientID, "CF-Access-Client-Secret": cfAccessClientSecret]
    }
}
