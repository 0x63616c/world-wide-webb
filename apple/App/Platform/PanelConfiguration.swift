import Foundation
import PanelKit

struct PanelConfiguration: Sendable {
    let serverURL: URL
    var api: PanelKit.PanelConfiguration { .init(baseURL: serverURL) }
    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        #if DEBUG
            serverURL =
                PanelKit.PanelConfiguration.fromEnvironment(["WWW_PANEL_API_URL": environment["PANEL_SERVER_URL"] ?? ""]
                )?.baseURL ?? PanelKit.PanelConfiguration.defaultBaseURL
        #else
            serverURL = PanelKit.PanelConfiguration.defaultBaseURL
        #endif
    }
}
