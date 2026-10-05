import ActivityKit
import Foundation
import Security

private struct AlarmCredentials: Codable {
  let url: URL
  let token: String
  let clientID: String
  let clientSecret: String
}

private struct NextAlarm: Decodable {
  let id: String
  let label: String
  let at: String
}

private struct AlarmSnapshot: Decodable { let next: NextAlarm? }

public enum PanelAlarmError: LocalizedError {
  case notConfigured, invalidDate, server(Int), invalidURL
  public var errorDescription: String? {
    switch self {
    case .notConfigured: return "Open Control Center once after configuring ALARM_API_TOKEN in the iOS build."
    case .invalidDate: return "Choose a future alarm date and time."
    case .server(let status): return "Control Center could not save the alarm (HTTP \(status)). Try again."
    case .invalidURL: return "The alarm server must use HTTPS."
    }
  }
}

// Never forward machine credentials to a Cloudflare login page or another host.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

/// Serialized across the WebView bridge and App Intents. The server owns the
/// schedule; this module only mirrors its next instant into ActivityKit.
public actor PanelAlarmCoordinator {
  public static let shared = PanelAlarmCoordinator()
  private let keychainAccount = "control-center-alarm-transport"
  private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)

  public func configure(url: String, token: String, clientID: String, clientSecret: String) throws {
    guard let endpoint = URL(string: url), endpoint.scheme == "https" ||
      (endpoint.scheme == "http" && ["localhost", "127.0.0.1"].contains(endpoint.host ?? "")) else { throw PanelAlarmError.invalidURL }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "co.worldwidewebb.panel.alarms", kSecAttrAccount as String: keychainAccount]
    // A build without a token revokes old native credentials instead of silently
    // retaining access. This never affects web/tRPC alarm management.
    if token.isEmpty { SecItemDelete(query as CFDictionary); return }
    let data = try JSONEncoder().encode(AlarmCredentials(url: endpoint, token: token, clientID: clientID, clientSecret: clientSecret))
    let attributes: [String: Any] = [kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      let added = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
      guard added == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(added)) }
    } else if status != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
  }

  private func credentials() throws -> AlarmCredentials {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "co.worldwidewebb.panel.alarms", kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data else { throw PanelAlarmError.notConfigured }
    return try JSONDecoder().decode(AlarmCredentials.self, from: data)
  }

  private func request(method: String, body: Data? = nil, key: String? = nil) async throws -> Data {
    let auth = try credentials()
    let endpoint = auth.url.appendingPathComponent("api/alarms")
    var request = URLRequest(url: endpoint, timeoutInterval: 12)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("Bearer \(auth.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
    if !auth.clientID.isEmpty && !auth.clientSecret.isEmpty {
      request.setValue(auth.clientID, forHTTPHeaderField: "CF-Access-Client-Id")
      request.setValue(auth.clientSecret, forHTTPHeaderField: "CF-Access-Client-Secret")
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw PanelAlarmError.server((response as? HTTPURLResponse)?.statusCode ?? 0)
    }
    return data
  }

  public func create(at: Date, label: String) async throws {
    guard at > Date() else { throw PanelAlarmError.invalidDate }
    let body = try JSONSerialization.data(withJSONObject: ["label": label,
      "at": ISO8601DateFormatter().string(from: at), "timeZone": TimeZone.current.identifier])
    // Reuse this key if the response is lost; the server deduplicates the insert.
    let key = UUID().uuidString
    do { _ = try await request(method: "POST", body: body, key: key) }
    catch let error as URLError where error.code == .timedOut || error.code == .networkConnectionLost {
      _ = try await request(method: "POST", body: body, key: key)
    }
    // Creation succeeded even if ActivityKit is unavailable/disabled.
    try? await refresh()
  }

  public func refresh() async throws {
    let data = try await request(method: "GET")
    let snapshot = try JSONDecoder().decode(AlarmSnapshot.self, from: data)
    try await updateActivity(snapshot.next)
  }

  public func sync(json: String) async throws {
    let snapshot = try JSONDecoder().decode(AlarmSnapshot.self, from: Data(json.utf8))
    try await updateActivity(snapshot.next)
  }

  private func updateActivity(_ next: NextAlarm?) async throws {
    guard #available(iOS 16.2, *) else { return }
    let current = Activity<NextAlarmAttributes>.activities
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = next.flatMap { formatter.date(from: $0.at) ?? ISO8601DateFormatter().date(from: $0.at) }
    let now = Date()
    guard let next, let date, date > now else {
      for activity in current { await activity.end(nil, dismissalPolicy: .immediate) }
      return
    }
    let content = ActivityContent(state: NextAlarmAttributes.ContentState(label: next.label, fireAt: date, updatedAt: now),
      staleDate: date)
    let matching = current.first { $0.attributes.alarmID == next.id }
    for activity in current where activity.id != matching?.id {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    if let matching { await matching.update(content) }
    else if ActivityAuthorizationInfo().areActivitiesEnabled {
      _ = try Activity.request(attributes: NextAlarmAttributes(alarmID: next.id), content: content, pushType: nil)
    }
  }
}
