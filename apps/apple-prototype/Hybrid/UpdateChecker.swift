import Foundation
import Observation
import PanelKit

/// One foreground-owned loop: launch and each activation check immediately, then poll.
@MainActor @Observable
final class UpdateChecker {
    private(set) var availableBuild: Int?
    @ObservationIgnored private let currentBuild: String
    @ObservationIgnored private let fetchBuild: () async throws -> Int
    @ObservationIgnored private let interval: TimeInterval
    @ObservationIgnored private let sleep: (TimeInterval) async throws -> Void
    @ObservationIgnored private let notifications: NotificationCenter
    @ObservationIgnored private var lastPostedBuild: Int = 0

    init(currentBuild: String, interval: TimeInterval = 900,
         notifications: NotificationCenter = NotificationCenter(),
         fetchBuild: @escaping () async throws -> Int,
         sleep: @escaping (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }) {
        self.currentBuild = currentBuild
        self.interval = interval.isFinite && interval > 0 ? interval : 900
        self.notifications = notifications
        self.fetchBuild = fetchBuild
        self.sleep = sleep
    }

    static func newerBuild(server: Int, current: String) -> Int? {
        guard !current.isEmpty, current.allSatisfy({ $0.isASCII && $0.isNumber }),
              let installed = Int(current), installed > 0, server > installed else { return nil }
        return server
    }

    func check() async {
        do {
            let server = try await fetchBuild()
            try Task.checkCancellation()
            availableBuild = Self.newerBuild(server: server, current: currentBuild)
            if let availableBuild, availableBuild > lastPostedBuild,
               !notifications.history.contains(where: { $0.dedupeKey == "update-\(availableBuild)" }) {
                notifications.post(sourceModule: "updates", title: "Update ready",
                    body: "Build \(availableBuild) is available in TestFlight.",
                    deepLink: PanelNotifications.updateDeepLink, priority: .high,
                    dedupeKey: "update-\(availableBuild)")
                lastPostedBuild = availableBuild
            }
        } catch is CancellationError {
            // A cancelled foreground task must not publish a late result.
        } catch {
            guard !Task.isCancelled else { return }
            availableBuild = nil
        }
    }

    func run() async {
        while !Task.isCancelled {
            await check()
            do { try await sleep(interval) } catch { return }
        }
    }

    static func live(configuration: PanelConfiguration, notifications: NotificationCenter) -> UpdateChecker {
        let transport = URLSessionConfiguration.ephemeral
        transport.urlCache = nil
        transport.httpCookieStorage = nil
        transport.urlCredentialStorage = nil
        let api = ReleasesAPI(client: PanelAPIClient(configuration: PanelKit.PanelConfiguration(
            baseURL: configuration.serverURL,
            accessClientID: configuration.accessHeaders["CF-Access-Client-Id"],
            accessClientSecret: configuration.accessHeaders["CF-Access-Client-Secret"]),
            transport: URLSession(configuration: transport)))
        var fakeBuild: Int?
        var interval: TimeInterval = 900
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        func argument(_ name: String) -> String? {
            guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }
        fakeBuild = argument("-updateCheckFakeBuild").flatMap(Int.init).flatMap { $0 > 0 ? $0 : nil }
        if let seconds = argument("-updateCheckIntervalSeconds").flatMap(Double.init), seconds.isFinite, seconds > 0 {
            interval = seconds
        }
        #endif
        let debugBuild = fakeBuild
        return UpdateChecker(currentBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
                             interval: interval, notifications: notifications, fetchBuild: {
            if let debugBuild { return debugBuild }
            return try await api.latest().build
        })
    }
}
