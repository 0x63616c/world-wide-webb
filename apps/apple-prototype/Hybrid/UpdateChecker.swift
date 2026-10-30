import Foundation
import Observation
import PanelKit
import UserNotifications

/// One foreground-owned loop: launch and each activation check immediately, then poll.
@MainActor @Observable
final class UpdateChecker {
    private(set) var availableBuild: Int?
    @ObservationIgnored private let currentBuild: String
    @ObservationIgnored private let fetchBuild: () async throws -> Int
    @ObservationIgnored private let interval: TimeInterval
    @ObservationIgnored private let sleep: (TimeInterval) async throws -> Void
    @ObservationIgnored private let notifications: UpdateNotifications

    init(currentBuild: String, interval: TimeInterval = 900,
         notifications: UpdateNotifications = UpdateNotifications(),
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
            if let availableBuild { await notifications.notify(build: availableBuild) }
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

    static func live(configuration: PanelConfiguration) -> UpdateChecker {
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
                             interval: interval, fetchBuild: {
            if let debugBuild { return debugBuild }
            return try await api.latest().build
        })
    }
}

/// Checks existing authorization only. Remember a build after successful scheduling.
@MainActor
final class UpdateNotifications {
    static let lastBuildKey = "panel.update.lastNotifiedBuild"
    private let defaults: UserDefaults
    private let authorization: () async -> UNAuthorizationStatus
    private let post: (Int) async throws -> Void
    private var pending: Set<Int> = []

    init(defaults: UserDefaults = .standard,
         authorization: @escaping () async -> UNAuthorizationStatus = {
             await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
         },
         post: @escaping (Int) async throws -> Void = { build in
             let content = UNMutableNotificationContent()
             content.title = "Update ready"
             content.body = "Build \(build) is available in TestFlight."
             try await UNUserNotificationCenter.current().add(UNNotificationRequest(
                 identifier: "panel-update-\(build)", content: content, trigger: nil))
         }) {
        self.defaults = defaults
        self.authorization = authorization
        self.post = post
    }

    func notify(build: Int) async {
        guard build > defaults.integer(forKey: Self.lastBuildKey), pending.insert(build).inserted else { return }
        defer { pending.remove(build) }
        let status = await authorization()
        guard !Task.isCancelled, status == .authorized || status == .provisional else { return }
        // Another invocation may have completed while authorization suspended.
        guard build > defaults.integer(forKey: Self.lastBuildKey) else { return }
        do {
            try await post(build)
            defaults.set(max(build, defaults.integer(forKey: Self.lastBuildKey)), forKey: Self.lastBuildKey)
        } catch { /* Retry on a later check; never prompt for permission. */ }
    }
}
