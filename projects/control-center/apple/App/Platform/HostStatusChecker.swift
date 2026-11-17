import Foundation
import Observation
import PanelKit

/// Polls the Mini's NAS/deploy summary and keeps the matching persistent notices current.
@MainActor @Observable
final class HostStatusChecker {
    private(set) var status: HostStatus?
    @ObservationIgnored private let fetch: () async throws -> HostStatus
    @ObservationIgnored private let interval: TimeInterval
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let sleep: (TimeInterval) async throws -> Void
    @ObservationIgnored private let notifications: NotificationCenter

    init(
        interval: TimeInterval = 60, notifications: NotificationCenter, now: @escaping () -> Date = Date.init,
        fetch: @escaping () async throws -> HostStatus,
        sleep: @escaping (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }
    ) {
        self.interval = interval
        self.notifications = notifications
        self.now = now
        self.fetch = fetch
        self.sleep = sleep
    }

    func check() async {
        do {
            let next = try await fetch()
            try Task.checkCancellation()
            status = next
            notifications.reconcileHost(next.notices(now: now()))
        } catch {
            // An unreachable server is already shown by each module; keep the last confirmed notices.
        }
    }

    func run() async {
        while !Task.isCancelled {
            await check()
            do { try await sleep(interval) } catch { return }
        }
    }

    static func live(configuration: PanelConfiguration, notifications: NotificationCenter) -> HostStatusChecker {
        let api = HostStatusAPI(client: PanelAPIClient(configuration: configuration.api))
        #if DEBUG
            // -hostStatusFake nas|deploy shows a notice without a failing Mini.
            let arguments = ProcessInfo.processInfo.arguments
            if let index = arguments.firstIndex(of: "-hostStatusFake"), arguments.indices.contains(index + 1) {
                let fake = arguments[index + 1]
                let since = Date().addingTimeInterval(-3_600)
                let status = HostStatus(
                    nas: fake == "nas"
                        ? .init(state: "failing", since: since, reason: "The NAS rejected the Mini’s login")
                        : .init(state: "ok"),
                    deploy: fake == "deploy"
                        ? .init(state: "blocked", since: since, reason: "The backup step failed")
                        : .init(state: "ok"))
                return HostStatusChecker(notifications: notifications, fetch: { status })
            }
        #endif
        return HostStatusChecker(notifications: notifications, fetch: { try await api.status() })
    }
}
