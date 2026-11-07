import CryptoKit
import DeviceCheck
import Foundation
import Security

struct CompetitionChallenge: Decodable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let challenge_id: String
  let nonce: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let expires_at_ms: Int64
}
struct CompetitionSession: Codable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let access_token: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let refresh_token: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let expires_at_ms: Int64
}
struct CompetitionServiceFailure: Decodable, Sendable {
  let code: String
}
enum CompetitionTransportError: Error {
  case unavailable, unauthorized, busy, invalidResponse
  case server(Int)
  case unsupportedAttestation
}

/// Device-only credential storage; never mirrored or exported with personal history.
struct CompetitionCredentialStore: Sendable {
  let service: String
  func read(_ account: String) throws -> Data? {
    var query = base(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw CompetitionTransportError.unavailable
    }
    return data
  }
  func write(_ data: Data, account: String) throws {
    let query = base(account)
    let status = SecItemUpdate(
      query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw CompetitionTransportError.unavailable }
    var insert = query
    insert[kSecValueData as String] = data
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
      throw CompetitionTransportError.unavailable
    }
  }
  func remove(_ account: String) throws {
    let status = SecItemDelete(base(account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw CompetitionTransportError.unavailable
    }
  }
  private func base(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false,
    ]
  }
}

/// Refuse redirects so neither bearer tokens nor signed mutation bodies leave the API origin.
private final class CompetitionRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable
{
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

actor CompetitionTransport {
  let origin: URL
  let deployment: String
  let deviceID: UUID
  private let credentials: CompetitionCredentialStore
  private let session: URLSession
  private var signing = false
  private var refreshing = false

  init(origin: URL, deployment: String, deviceID: UUID, bundleID: String) throws {
    let expectedHost =
      deployment == "production" ? "api.getfolding.app" : "api-staging.getfolding.app"
    guard ["production", "staging"].contains(deployment), origin.scheme == "https",
      origin.host == expectedHost, origin.user == nil, origin.password == nil,
      origin.port == nil, origin.query == nil, origin.fragment == nil,
      origin.path.isEmpty || origin.path == "/"
    else { throw CompetitionTransportError.unavailable }
    self.origin = origin
    self.deployment = deployment
    self.deviceID = deviceID
    credentials = CompetitionCredentialStore(service: "\(bundleID).competition.\(deployment)")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 60
    session = URLSession(
      configuration: configuration, delegate: CompetitionRedirectPolicy(), delegateQueue: nil)
  }

  static func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
  }

  func saveSession(_ value: CompetitionSession) throws {
    try credentials.write(Self.encode(value), account: "session")
  }
  func clearSession() throws {
    for account in [
      "session", "refresh-operation", "attest-enrolled", "attest-key", "attest-pending",
    ] {
      try credentials.remove(account)
    }
  }

  func challenge(purpose: String) async throws -> CompetitionChallenge {
    try await send(
      "POST", path: "/v1/auth/challenges", body: Self.encode(["purpose": purpose]),
      authenticated: false)
  }

  func send<Response: Decodable & Sendable>(
    _ method: String, path: String, body: Data? = nil,
    authenticated: Bool = true, contentType: String = "application/json"
  ) async throws -> Response {
    let token = authenticated ? try await accessToken() : nil
    return try await execute(method, path: path, body: body, token: token, contentType: contentType)
  }

  private func accessToken() async throws -> String {
    guard let data = try credentials.read("session") else {
      throw CompetitionTransportError.unauthorized
    }
    let stored = try JSONDecoder().decode(CompetitionSession.self, from: data)
    if stored.expires_at_ms > TrackingRuntime.nowMS + 30_000 { return stored.access_token }
    guard !refreshing else { throw CompetitionTransportError.busy }
    refreshing = true
    defer { refreshing = false }
    // Persist the exact refresh operation before sending, so response-loss retries keep its identity.
    struct Refresh: Codable {
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let operation_id: String
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let refresh_token: String
    }
    let request: Refresh
    if let pending = try credentials.read("refresh-operation") {
      request = try JSONDecoder().decode(Refresh.self, from: pending)
    } else {
      request = Refresh(
        operation_id: UUID().uuidString.lowercased(), refresh_token: stored.refresh_token)
      try credentials.write(Self.encode(request), account: "refresh-operation")
    }
    let updated: CompetitionSession = try await execute(
      "POST", path: "/v1/auth/refresh",
      body: Self.encode(request), token: nil)
    try saveSession(updated)
    try credentials.remove("refresh-operation")
    return updated.access_token
  }

  func enrollKey() async throws -> String {
    guard !signing else { throw CompetitionTransportError.busy }
    signing = true
    defer { signing = false }
    return try await ensureKey()
  }

  private func ensureKey() async throws -> String {
    let attest = DCAppAttestService.shared
    guard attest.isSupported else { throw CompetitionTransportError.unsupportedAttestation }
    if let enrolled = try credentials.read("attest-enrolled"),
      let id = String(data: enrolled, encoding: .utf8)
    {
      return id
    }
    let key: String
    if let saved = try credentials.read("attest-key"), let id = String(data: saved, encoding: .utf8)
    {
      key = id
    } else {
      key = try await attest.generateKey()
      try credentials.write(Data(key.utf8), account: "attest-key")
    }
    let challenge: CompetitionChallenge = try await send(
      "POST", path: "/v1/attestation/challenges",
      body: Self.encode([
        "purpose": "enroll_key", "device_id": deviceID.uuidString.lowercased(), "key_id": key,
      ]))
    guard let nonce = Self.decodeBase64URL(challenge.nonce), nonce.count == 32 else {
      throw CompetitionTransportError.invalidResponse
    }
    let object = try await attest.attestKey(key, clientDataHash: Data(SHA256.hash(data: nonce)))
    struct Enrollment: Decodable, Sendable {
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let key_id: String
      let enrolled: Bool
    }
    let result: Enrollment = try await send(
      "POST", path: "/v1/attestation/keys",
      body: Self.encode([
        "operation_id": UUID().uuidString.lowercased(),
        "device_id": deviceID.uuidString.lowercased(),
        "key_id": key, "challenge_id": challenge.challenge_id,
        "attestation_base64": object.base64EncodedString(),
      ]))
    guard result.enrolled, result.key_id == key else {
      throw CompetitionTransportError.invalidResponse
    }
    try credentials.write(Data(key.utf8), account: "attest-enrolled")
    return key
  }

  func protected<Response: Decodable & Sendable>(
    _ method: String, path: String, purpose: String,
    body: Data, contentType: String = "application/json"
  ) async throws -> Response {
    guard !signing else { throw CompetitionTransportError.busy }
    guard !path.contains("?") else { throw CompetitionTransportError.invalidResponse }
    signing = true
    defer { signing = false }
    let key = try await ensureKey()
    let token = try await accessToken()
    let challenge: CompetitionChallenge = try await execute(
      "POST", path: "/v1/attestation/challenges",
      body: Self.encode([
        "purpose": purpose, "device_id": deviceID.uuidString.lowercased(), "key_id": key,
      ]), token: token)
    let digest = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
    let binding =
      "Folding-v1\n\(deployment)\n\(method)\n\(path)\n\(challenge.challenge_id)\n\(challenge.nonce)\n\(digest)"
    let assertion = try await DCAppAttestService.shared.generateAssertion(
      key,
      clientDataHash: Data(SHA256.hash(data: Data(binding.utf8))))
    return try await execute(
      method, path: path, body: body, token: token, contentType: contentType,
      headers: [
        "X-Folding-Key-ID": key, "X-Folding-Challenge-ID": challenge.challenge_id,
        "X-Folding-Assertion": assertion.base64EncodedString().replacingOccurrences(
          of: "+", with: "-"
        )
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: ""),
      ])
  }

  private func execute<Response: Decodable & Sendable>(
    _ method: String, path: String, body: Data?,
    token: String?, authorizationScheme: String = "Bearer",
    contentType: String = "application/json", headers: [String: String] = [:]
  ) async throws -> Response {
    guard path.hasPrefix("/v1/"), let url = URL(string: path, relativeTo: origin)?.absoluteURL,
      url.host == origin.host, url.scheme == "https"
    else { throw CompetitionTransportError.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token {
      request.setValue("\(authorizationScheme) \(token)", forHTTPHeaderField: "Authorization")
    }
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw CompetitionTransportError.invalidResponse
    }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 { throw CompetitionTransportError.unauthorized }
      throw CompetitionTransportError.server(http.statusCode)
    }
    guard data.count <= 2 * 1024 * 1024 else { throw CompetitionTransportError.invalidResponse }
    return try JSONDecoder().decode(Response.self, from: data)
  }

  func saveRemoval(_ value: CompetitionRemovalOperation) throws {
    try credentials.write(Self.encode(value), account: "removal")
  }
  func pendingRemoval() throws -> CompetitionRemovalOperation? {
    guard let data = try credentials.read("removal") else { return nil }
    return try JSONDecoder().decode(CompetitionRemovalOperation.self, from: data)
  }
  func finishRemoval() throws { try credentials.remove("removal") }
  func deletionStatus(operationID: String, token: String) async throws -> CompetitionOperation {
    guard UUID(uuidString: operationID) != nil else {
      throw CompetitionTransportError.invalidResponse
    }
    return try await execute(
      "GET", path: "/v1/operations/\(operationID)", body: nil,
      token: token, authorizationScheme: "Deletion")
  }

  private static func decodeBase64URL(_ value: String) -> Data? {
    var standard = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    standard += String(repeating: "=", count: (4 - standard.count % 4) % 4)
    return Data(base64Encoded: standard)
  }

  func avatarImage(_ id: String) async throws -> Data {
    guard UUID(uuidString: id) != nil,
      let url = URL(string: "/v1/avatars/\(id)/image", relativeTo: origin)?.absoluteURL
    else { throw CompetitionTransportError.invalidResponse }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
    let (bytes, response) = try await session.bytes(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200,
      http.mimeType == "image/jpeg"
    else { throw CompetitionTransportError.invalidResponse }
    var data = Data()
    for try await byte in bytes {
      guard data.count < 512 * 1024 else { throw CompetitionTransportError.invalidResponse }
      data.append(byte)
    }
    return data
  }
}
