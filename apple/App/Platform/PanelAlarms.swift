import Foundation
import PanelKit

protocol PanelAlarmCoordinating: Sendable {
    func configure(url: String) async throws
    func refresh() async throws
    func sync(json: String) async throws
}

extension PanelAlarmCoordinator: PanelAlarmCoordinating {}

/// Mirrors the native alarm provider's next alarm into ActivityKit.
@MainActor
final class PanelAlarms {
    private let coordinator: any PanelAlarmCoordinating
    private var configuration: Task<Void, any Error>?

    init(coordinator: any PanelAlarmCoordinating = PanelAlarmCoordinator.shared) {
        self.coordinator = coordinator
    }

    func configure(serverURL: URL) {
        configuration = Task {
            try await coordinator.configure(url: serverURL.absoluteString)
        }
    }

    func refresh() async {
        guard let configuration else { return }
        // Foreground refresh must wait for launch-time endpoint configuration.
        // An unavailable server must not interrupt the board.
        do {
            try await configuration.value
            try await coordinator.refresh()
        } catch {}
    }

    func sync(next: AlarmNext?) async throws {
        let json = String(decoding: try JSONEncoder().encode(NextAlarmPayload(next: next)), as: UTF8.self)
        try await coordinator.sync(json: json)
    }
}

private struct NextAlarmPayload: Encodable {
    let next: AlarmNext?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let next { try container.encode(next, forKey: .next) } else { try container.encodeNil(forKey: .next) }
    }

    private enum CodingKeys: String, CodingKey { case next }
}
