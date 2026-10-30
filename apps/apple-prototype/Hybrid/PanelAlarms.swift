import Foundation

protocol PanelAlarmCoordinating: Sendable {
    func configure(url: String, token: String, clientID: String, clientSecret: String) async throws
    func refresh() async throws
    func sync(json: String) async throws
}

extension PanelAlarmCoordinator: PanelAlarmCoordinating {}

/// Mirrors the server's next alarm into ActivityKit. Web-mode snapshots and
/// the opted-in native provider share this widget path; NativeAlarmsRuntime
/// separately owns the AlarmKit/web ringer handoff.
@MainActor
final class PanelAlarms {
    private let coordinator: any PanelAlarmCoordinating
    private var configuration: Task<Void, any Error>?

    init(coordinator: any PanelAlarmCoordinating = PanelAlarmCoordinator.shared) {
        self.coordinator = coordinator
    }

    func configure(serverURL: URL, token: String, cfID: String, cfSecret: String) {
        guard !token.isEmpty else { return }
        configuration = Task {
            try await coordinator.configure(url: serverURL.absoluteString, token: token,
                                            clientID: cfID, clientSecret: cfSecret)
        }
    }

    func refresh() async {
        guard let configuration else { return }
        // Foreground refresh must wait for launch-time Keychain storage.
        // Like Expo, an unavailable server must not interrupt the board.
        do {
            try await configuration.value
            try await coordinator.refresh()
        } catch {}
    }

    func sync(next: JSONValue) async throws {
        let snapshot = JSONValue.object(["next": next])
        let json = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
        try await coordinator.sync(json: json)
    }
}
