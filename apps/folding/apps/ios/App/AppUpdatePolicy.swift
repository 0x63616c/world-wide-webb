import Foundation
import Observation
import SwiftUI

@MainActor @Observable final class AppUpdatePolicy {
  static let shared = AppUpdatePolicy()
  private(set) var minimumBuild: Int
  private(set) var checking = false
  private(set) var checkFailed = false
  let installedBuild: Int
  let environment: String
  let updateURL: URL
  private let origin: URL?
  private let defaults: UserDefaults
  private let session: URLSession
  private let now: @Sendable () -> Date
  private var lastCheck: Date?
  private var revision = UUID()
  private var key: String { "folding.minimumBuild.\(environment)" }
  var requiresUpdate: Bool { minimumBuild > installedBuild }

  init(
    environment: String = Bundle.main.object(forInfoDictionaryKey: "FoldingEnvironment") as? String
      ?? "development",
    origin: URL? = (Bundle.main.object(forInfoDictionaryKey: "FoldingAPIOrigin") as? String)
      .flatMap(URL.init(string:)),
    installedBuild: Int = Int(
      Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0,
    defaults: UserDefaults = .standard, session: URLSession? = nil,
    testFlight: Bool = Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt",
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.environment = environment
    let expected =
      environment == "production"
      ? "https://api.getfolding.app"
      : environment == "staging" ? "https://api-staging.getfolding.app" : ""
    self.origin = origin?.absoluteString == expected ? origin : nil
    self.installedBuild = installedBuild
    self.defaults = defaults
    self.now = now
    let cached = defaults.integer(forKey: "folding.minimumBuild.\(environment)")
    minimumBuild = (0...Int(Int32.max)).contains(cached) ? cached : 0
    updateURL = URL(
      string: testFlight || environment == "staging"
        ? "https://testflight.apple.com/" : "https://apps.apple.com/app/id6832059501")!
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.urlCache = nil
    config.timeoutIntervalForRequest = 10
    config.timeoutIntervalForResource = 15
    self.session = session ?? URLSession(configuration: config)
  }

  func require(minimumBuild: Int, environment: String) {
    guard environment == self.environment, minimumBuild > installedBuild,
      minimumBuild <= Int(Int32.max)
    else { return }
    if minimumBuild > self.minimumBuild { revision = UUID() }
    self.minimumBuild = max(self.minimumBuild, minimumBuild)
    defaults.set(self.minimumBuild, forKey: key)
  }

  func refresh(force: Bool = false) async {
    guard !checking, let origin,
      ["https://api.getfolding.app", "https://api-staging.getfolding.app"].contains(
        origin.absoluteString),
      force || lastCheck.map({ now().timeIntervalSince($0) >= 900 }) ?? true
    else { return }
    checking = true
    let context = revision
    lastCheck = now()
    defer { checking = false }
    do {
      var request = URLRequest(url: origin.appendingPathComponent("v1/client-policy"))
      request.setValue("\(installedBuild)", forHTTPHeaderField: "X-Folding-Build")
      let (data, response) = try await session.data(for: request)
      struct Policy: Decodable {
        let minimumBuild: Int
        enum CodingKeys: String, CodingKey { case minimumBuild = "minimum_ios_build" }
      }
      guard let http = response as? HTTPURLResponse, http.statusCode == 200,
        http.url?.host == origin.host, http.url?.scheme == "https", data.count <= 16384
      else { throw CompetitionTransportError.invalidResponse }
      let policy = try JSONDecoder().decode(Policy.self, from: data)
      guard (0...Int(Int32.max)).contains(policy.minimumBuild) else {
        throw CompetitionTransportError.invalidResponse
      }
      guard context == revision else { return }
      // A fresh successful response can lower the floor, allowing emergency rollback.
      minimumBuild = policy.minimumBuild
      defaults.set(minimumBuild, forKey: key)
      checkFailed = false
    } catch {
      // Unknown policy fails open; known requirements survive offline starts/failures.
      checkFailed = true
    }
  }
}

#if canImport(UIKit)
  struct AppUpdateRequiredView: View {
    let policy: AppUpdatePolicy
    @Environment(\.openURL) private var openURL
    var body: some View {
      ScrollView {
        VStack(spacing: 24) {
          Image(systemName: "arrow.down.app").font(.largeTitle).accessibilityHidden(true)
          Text(String(localized: "update.title", defaultValue: "A newer version is required"))
            .font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
          Button(String(localized: "update.open", defaultValue: "Update")) {
            openURL(policy.updateURL)
          }
          .buttonStyle(.borderedProminent)
          if policy.checking { ProgressView() }
          if policy.checkFailed {
            Text(
              String(
                localized: "update.offline",
                defaultValue: "Couldn’t check for updates.")
            )
            .font(.footnote).foregroundStyle(.secondary)
          }
          Link(
            String(localized: "update.support", defaultValue: "Contact support"),
            destination: URL(string: "https://getfolding.app/support")!
          )
          .font(.footnote)
        }
        .multilineTextAlignment(.center).padding(32).frame(maxWidth: .infinity)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemBackground))
    }
  }

#endif
