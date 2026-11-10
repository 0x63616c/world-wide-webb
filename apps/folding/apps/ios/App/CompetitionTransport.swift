import CryptoKit
import DeviceCheck
import FoldingData
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
  let retryable: Bool?
  let retryAfterSeconds: Int?
  let minimumBuild: Int?
  enum CodingKeys: String, CodingKey {
    case code, retryable
    case retryAfterSeconds = "retry_after_seconds"
    case minimumBuild = "minimum_ios_build"
  }
}
enum CompetitionTransportError: Error {
  case unavailable, unauthorized, busy, invalidResponse
  case server(Int)
  case service(status: Int, code: String, retryable: Bool, retryAfter: TimeInterval?)
  case unsupportedAttestation

  var statusCode: Int? {
    switch self {
    case .server(let status), .service(let status, _, _, _): return status
    case .unauthorized: return 401
    default: return nil
    }
  }
}

extension CompetitionTransportError: CompetitionJoinFailure {
  var joinMessage: String {
    let base = String(localized: "error.tryAgain", defaultValue: "Something went wrong.")
    switch self {
    case .service(_, let code, _, _): return "\(base) (\(code))"
    case .server(let status): return "\(base) (HTTP \(status))"
    case .unsupportedAttestation: return "\(base) (App Attest unavailable)"
    case .unauthorized: return "\(base) (unauthorized)"
    case .busy: return "\(base) (busy)"
    case .invalidResponse: return "\(base) (invalid response)"
    case .unavailable: return "\(base) (service unavailable)"
    }
  }
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

protocol CompetitionAttestation: Sendable {
  var isSupported: Bool { get }
  func generateKey() async throws -> String
  func attestKey(_ key: String, clientDataHash: Data) async throws -> Data
  func generateAssertion(_ key: String, clientDataHash: Data) async throws -> Data
}

private struct AppleCompetitionAttestation: CompetitionAttestation {
  var isSupported: Bool { DCAppAttestService.shared.isSupported }
  func generateKey() async throws -> String { try await DCAppAttestService.shared.generateKey() }
  func attestKey(_ key: String, clientDataHash: Data) async throws -> Data {
    try await DCAppAttestService.shared.attestKey(key, clientDataHash: clientDataHash)
  }
  func generateAssertion(_ key: String, clientDataHash: Data) async throws -> Data {
    try await DCAppAttestService.shared.generateAssertion(key, clientDataHash: clientDataHash)
  }
}

actor CompetitionTransport {
  let origin: URL
  let deployment: String
  let deviceID: UUID
  private var avatarContextRevision = UUID()
  private var sessionRevision = UUID()
  private let credentials: CompetitionCredentialStore
  private let session: URLSession
  private let attestation: any CompetitionAttestation
  private var diagnosticRecorder: (@Sendable (TrackingDiagnosticEntry) async -> Void)?
  private var uploadDiagnostics: (worker: String, queue: String)?
  private var signing = false
  private var sessionRefresh: (id: UUID, task: Task<String, Error>)?
  private var readRevision = UUID()
  private var recentReads: [String: (data: Data, expiresMS: Int64)] = [:]
  private var pendingReads: [String: Task<Data, Error>] = [:]
  private let nowMS: @Sendable () -> Int64
  private let installedBuild: Int
  private let onUpdateRequired: @Sendable (Int) async -> Void

  private struct ServerCooldown: Codable {
    let untilMS: Int64
    let status: Int
  }

  init(
    origin: URL, deployment: String, deviceID: UUID, bundleID: String,
    session injectedSession: URLSession? = nil, attestation: (any CompetitionAttestation)? = nil,
    nowMS: @escaping @Sendable () -> Int64 = { TrackingRuntime.nowMS },
    installedBuild: Int = Int(
      Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0,
    onUpdateRequired: (@Sendable (Int) async -> Void)? = nil
  ) throws {
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
    self.nowMS = nowMS
    self.installedBuild = installedBuild
    self.onUpdateRequired =
      onUpdateRequired ?? { minimum in
        await AppUpdatePolicy.shared.require(minimumBuild: minimum, environment: deployment)
      }
    credentials = CompetitionCredentialStore(service: "\(bundleID).competition.\(deployment)")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 60
    self.attestation = attestation ?? AppleCompetitionAttestation()
    session =
      injectedSession
      ?? URLSession(
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
  func sessionContext() -> UUID { sessionRevision }

  func setUploadDiagnostics(worker: String, queue: String) {
    uploadDiagnostics = (worker, queue)
  }

  func invalidateCommunityReads() { invalidateReads() }

  func setDiagnosticRecorder(
    _ recorder: @escaping @Sendable (TrackingDiagnosticEntry) async -> Void
  ) {
    diagnosticRecorder = recorder
  }

  func diagnosticCredentialSummary() -> [String: String] {
    struct Expiry: Decodable {
      let expiresAtMS: Int64
      enum CodingKeys: String, CodingKey { case expiresAtMS = "expires_at_ms" }
    }
    let data = try? credentials.read("session")
    let expiry = data.flatMap { try? JSONDecoder().decode(Expiry.self, from: $0) }
    let enrolled = (try? credentials.read("attest-enrolled")) != nil
    return
      [
        "session_present": String(data != nil),
        "session_expired": String(expiry.map { $0.expiresAtMS <= nowMS() } ?? true),
        "attest_key_enrolled": String(enrolled),
        "attest_key_present": String((try? credentials.read("attest-key")) != nil),
        "attest_pending_proof": String((try? credentials.read("attest-pending")) != nil),
      ]
  }

  private func recordDiagnostic(
    _ event: TrackingDiagnosticEntry.Event, error: Error? = nil, durationMS: Int? = nil
  ) {
    guard let diagnosticRecorder else { return }
    let failure = error.map(FoldingDiagnostics.errorInfo)
    let entry = TrackingDiagnosticEntry(
      atMS: nowMS(), event: event,
      reason: failure?.0, detail: failure?.1, durationMS: durationMS)
    Task { await diagnosticRecorder(entry) }
  }

  private func recordNetwork(
    _ path: String, started: TimeInterval, data: Data? = nil, status: Int? = nil,
    error: Error? = nil, requestID: UUID? = nil
  ) {
    guard let diagnosticRecorder else { return }
    struct Correlation: Decodable {
      let requestID: UUID?
      let code: String?
      enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case code
      }
    }
    let correlation = data.flatMap {
      $0.count <= 128 * 1024 ? try? JSONDecoder().decode(Correlation.self, from: $0) : nil
    }
    let failure = error.map(FoldingDiagnostics.errorInfo)
    let entry = TrackingDiagnosticEntry(
      atMS: nowMS(), event: .network,
      reason: failure?.0
        ?? correlation?.code.flatMap(TrackingDiagnosticEntry.Reason.init(rawValue:)),
      route: FoldingDiagnostics.route(path), status: status, detail: failure?.1,
      durationMS: Int(max(0, ProcessInfo.processInfo.systemUptime - started) * 1000),
      requestID: requestID ?? correlation?.requestID)
    Task { await diagnosticRecorder(entry) }
  }

  func replaceSession(_ value: CompetitionSession, context: UUID) throws {
    guard context == sessionRevision else { throw CancellationError() }
    try clearSession()
    try saveSession(value)
  }

  func clearSession() throws {
    sessionRevision = UUID()
    sessionRefresh?.task.cancel()
    sessionRefresh = nil
    invalidateReads()
    avatarContextRevision = UUID()
    for account in [
      "session", "refresh-operation", "attest-enrolled", "attest-key", "attest-pending",
      "avatar-upload", "avatar-removals",
    ] {
      try credentials.remove(account)
    }
  }

  func avatarContext() -> UUID { avatarContextRevision }

  func avatarUpload() throws -> CompetitionAvatarUpload? {
    guard let data = try credentials.read("avatar-upload") else { return nil }
    return try JSONDecoder().decode(CompetitionAvatarUpload.self, from: data)
  }
  func saveAvatarUpload(_ upload: CompetitionAvatarUpload?, context: UUID) throws {
    guard context == avatarContextRevision else { throw CancellationError() }
    if let upload {
      try credentials.write(Self.encode(upload), account: "avatar-upload")
    } else {
      try credentials.remove("avatar-upload")
    }
  }
  func avatarRemovalOperation(id: String, context: UUID) throws -> String {
    guard context == avatarContextRevision else { throw CancellationError() }
    let values =
      try credentials.read("avatar-removals").map {
        try JSONDecoder().decode([String: String].self, from: $0)
      } ?? [:]
    if let operation = values[id] { return operation }
    var next = values
    let operation = UUID().uuidString.lowercased()
    next[id] = operation
    try credentials.write(Self.encode(next), account: "avatar-removals")
    return operation
  }
  func finishAvatarRemoval(id: String, context: UUID) throws {
    guard context == avatarContextRevision else { throw CancellationError() }
    var values =
      try credentials.read("avatar-removals").map {
        try JSONDecoder().decode([String: String].self, from: $0)
      } ?? [:]
    values[id] = nil
    try credentials.write(Self.encode(values), account: "avatar-removals")
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
    let revision = sessionRevision
    let token = authenticated ? try await accessToken() : nil
    guard revision == sessionRevision else { throw CancellationError() }
    do {
      return try await execute(
        method, path: path, body: body, token: token, contentType: contentType)
    } catch CompetitionTransportError.unauthorized where authenticated {
      let refreshed = try await accessToken(forceRefresh: true)
      guard revision == sessionRevision else { throw CancellationError() }
      return try await execute(
        method, path: path, body: body, token: refreshed, contentType: contentType)
    }
  }

  private func accessToken(forceRefresh: Bool = false) async throws -> String {
    let revision = sessionRevision
    guard let data = try credentials.read("session") else {
      throw CompetitionTransportError.unauthorized
    }
    let stored = try JSONDecoder().decode(CompetitionSession.self, from: data)
    if !forceRefresh, stored.expires_at_ms > nowMS() + 30_000 {
      return stored.access_token
    }
    if let pending = sessionRefresh {
      recordDiagnostic(.sessionRefreshJoined)
      let token = try await pending.task.value
      try Task.checkCancellation()
      guard revision == sessionRevision else { throw CancellationError() }
      return token
    }
    let id = UUID()
    recordDiagnostic(.sessionRefreshStarted)
    let task = Task { try await self.refreshSession(stored, revision: revision) }
    sessionRefresh = (id, task)
    defer { if sessionRefresh?.id == id { sessionRefresh = nil } }
    let token = try await task.value
    try Task.checkCancellation()
    guard revision == sessionRevision else { throw CancellationError() }
    return token
  }

  private func refreshSession(_ stored: CompetitionSession, revision: UUID) async throws -> String {
    let started = ProcessInfo.processInfo.systemUptime
    do {
      let token = try await performSessionRefresh(stored, revision: revision)
      recordDiagnostic(
        .sessionRefreshCompleted,
        durationMS: Int((ProcessInfo.processInfo.systemUptime - started) * 1000))
      return token
    } catch {
      recordDiagnostic(.sessionRefreshFailed, error: error)
      throw error
    }
  }

  private func performSessionRefresh(_ stored: CompetitionSession, revision: UUID) async throws
    -> String
  {
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
    guard revision == sessionRevision else { throw CancellationError() }
    try saveSession(updated)
    try credentials.remove("refresh-operation")
    return updated.access_token
  }

  func enrollKey() async throws -> String {
    guard !signing else {
      recordDiagnostic(.signingBusy, error: CompetitionTransportError.busy)
      throw CompetitionTransportError.busy
    }
    signing = true
    defer { signing = false }
    do { return try await ensureKey() } catch {
      recordDiagnostic(.attestationEnrollmentFailed, error: error)
      throw error
    }
  }

  private func ensureKey(recoverExpiredProof: Bool = true) async throws -> String {
    let revision = sessionRevision
    let attest = attestation
    guard attest.isSupported else { throw CompetitionTransportError.unsupportedAttestation }
    if let enrolled = try credentials.read("attest-enrolled"),
      let id = String(data: enrolled, encoding: .utf8)
    {
      return id
    }
    recordDiagnostic(.attestationEnrollmentStarted)
    // A successful Apple proof can only be generated once per key. Persist the exact
    // request before network IO, and replay it even after challenge expiry: the server
    // checks the durable operation receipt before checking the challenge.
    let body: Data
    let key: String
    if let pending = try credentials.read("attest-pending") {
      let fields = try JSONDecoder().decode([String: String].self, from: pending)
      guard let id = fields["key_id"] else { throw CompetitionTransportError.invalidResponse }
      key = id
      body = pending
    } else {
      if let saved = try credentials.read("attest-key"),
        let id = String(data: saved, encoding: .utf8)
      {
        key = id
      } else {
        recordDiagnostic(.attestationKeyGenerationStarted)
        key = try await attest.generateKey()
        recordDiagnostic(.attestationKeyGenerated)
        guard revision == sessionRevision else { throw CancellationError() }
        try credentials.write(Data(key.utf8), account: "attest-key")
      }
      let challenge: CompetitionChallenge = try await send(
        "POST", path: "/v1/attestation/challenges",
        body: Self.encode([
          "purpose": "enroll_key", "device_id": deviceID.uuidString.lowercased(), "key_id": key,
        ]))
      guard revision == sessionRevision else { throw CancellationError() }
      guard let nonce = Self.decodeBase64URL(challenge.nonce), nonce.count == 32 else {
        throw CompetitionTransportError.invalidResponse
      }
      let object: Data
      do {
        object = try await attest.attestKey(key, clientDataHash: Data(SHA256.hash(data: nonce)))
      } catch {
        guard revision == sessionRevision else { throw CancellationError() }
        if (error as NSError).domain == DCError.errorDomain,
          (error as NSError).code == DCError.Code.invalidKey.rawValue
        {
          try credentials.remove("attest-key")
        }
        // Apple service outages preserve the key; an invalid/previously consumed key
        // is replaced on the next bounded retry, never by an unbounded recursion.
        throw error
      }
      guard revision == sessionRevision else { throw CancellationError() }
      body = try Self.encode([
        "operation_id": UUID().uuidString.lowercased(),
        "device_id": deviceID.uuidString.lowercased(), "key_id": key,
        "challenge_id": challenge.challenge_id, "attestation_base64": object.base64EncodedString(),
      ])
      try credentials.write(body, account: "attest-pending")
    }
    struct Enrollment: Decodable, Sendable {
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let key_id: String
      let enrolled: Bool
    }
    let result: Enrollment
    do {
      result = try await send("POST", path: "/v1/attestation/keys", body: body)
    } catch CompetitionTransportError.service(_, let code, _, _) where code == "challenge_expired" {
      guard revision == sessionRevision else { throw CancellationError() }
      // The server has explicitly confirmed no receipt exists for this proof.
      try credentials.remove("attest-pending")
      try credentials.remove("attest-key")
      recordDiagnostic(.attestationProofExpired)
      if recoverExpiredProof { return try await ensureKey(recoverExpiredProof: false) }
      throw CompetitionTransportError.unavailable
    }
    guard revision == sessionRevision else { throw CancellationError() }
    guard result.enrolled, result.key_id == key else {
      throw CompetitionTransportError.invalidResponse
    }
    try credentials.write(Data(key.utf8), account: "attest-enrolled")
    try credentials.remove("attest-pending")
    recordDiagnostic(.attestationEnrollmentCompleted)
    return key
  }

  func protected<Response: Decodable & Sendable>(
    _ method: String, path: String, purpose: String,
    body: Data, contentType: String = "application/json"
  ) async throws -> Response {
    guard !signing else {
      recordDiagnostic(.signingBusy, error: CompetitionTransportError.busy)
      throw CompetitionTransportError.busy
    }
    guard !path.contains("?") else { throw CompetitionTransportError.invalidResponse }
    signing = true
    defer { signing = false }
    let revision = sessionRevision
    do {
      return try await protectedAttempt(
        method, path: path, purpose: purpose, body: body, contentType: contentType)
    } catch CompetitionTransportError.unauthorized {
      guard revision == sessionRevision else { throw CancellationError() }
      _ = try await accessToken(forceRefresh: true)
      guard revision == sessionRevision else { throw CancellationError() }
      return try await protectedAttempt(
        method, path: path, purpose: purpose, body: body, contentType: contentType)
    }
  }

  private func protectedAttempt<Response: Decodable & Sendable>(
    _ method: String, path: String, purpose: String, body: Data, contentType: String
  ) async throws -> Response {
    let revision = sessionRevision
    let key: String
    do { key = try await ensureKey() } catch {
      recordDiagnostic(.attestationEnrollmentFailed, error: error)
      throw error
    }
    let token = try await accessToken()
    guard revision == sessionRevision else { throw CancellationError() }
    let challenge: CompetitionChallenge = try await execute(
      "POST", path: "/v1/attestation/challenges",
      body: Self.encode([
        "purpose": purpose, "device_id": deviceID.uuidString.lowercased(), "key_id": key,
      ]), token: token)
    let digest = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
    let binding =
      "Folding-v1\n\(deployment)\n\(method)\n\(path)\n\(challenge.challenge_id)\n\(challenge.nonce)\n\(digest)"
    let assertion: Data
    let assertionStarted = ProcessInfo.processInfo.systemUptime
    recordDiagnostic(.attestationAssertionStarted)
    do {
      assertion = try await attestation.generateAssertion(
        key, clientDataHash: Data(SHA256.hash(data: Data(binding.utf8))))
    } catch {
      guard revision == sessionRevision else { throw CancellationError() }
      recordDiagnostic(.attestationAssertionFailed, error: error)
      if (error as NSError).domain == DCError.errorDomain,
        (error as NSError).code == DCError.Code.invalidKey.rawValue
      {
        try credentials.remove("attest-enrolled")
        try credentials.remove("attest-key")
        try credentials.remove("attest-pending")
      }
      throw error
    }
    guard revision == sessionRevision else { throw CancellationError() }
    recordDiagnostic(
      .attestationAssertionCompleted,
      durationMS: Int((ProcessInfo.processInfo.systemUptime - assertionStarted) * 1000))
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

  private func invalidateReads() {
    readRevision = UUID()
    recentReads.removeAll()
    pendingReads.removeAll()
  }

  private func execute<Response: Decodable & Sendable>(
    _ method: String, path: String, body: Data?,
    token: String?, authorizationScheme: String = "Bearer",
    contentType: String = "application/json", headers: [String: String] = [:]
  ) async throws -> Response {
    let requestSession = sessionRevision
    let cacheable =
      method == "GET" && authorizationScheme == "Bearer"
      && (path.hasPrefix("/v1/leaderboards?") || path.hasPrefix("/v1/results?"))
    if method != "GET" { invalidateReads() }
    let key = sessionRevision.uuidString + readRevision.uuidString + path
    let data: Data
    if cacheable, let cached = recentReads[key], cached.expiresMS > nowMS() {
      data = cached.data
    } else if cacheable, let pending = pendingReads[key] {
      data = try await pending.value
    } else if cacheable {
      let context = readRevision
      let revision = sessionRevision
      let pending = Task {
        try await self.executeData(
          method, path: path, body: body, token: token,
          authorizationScheme: authorizationScheme, contentType: contentType, headers: headers)
      }
      pendingReads[key] = pending
      do {
        data = try await pending.value
        pendingReads[key] = nil
        guard revision == sessionRevision else { throw CancellationError() }
        if context == readRevision {
          recentReads = recentReads.filter { $0.value.expiresMS > nowMS() }
          if recentReads.count >= 20 { recentReads.removeAll() }
          recentReads[key] = (data, nowMS() + 15_000)
        }
      } catch {
        pendingReads[key] = nil
        throw error
      }
    } else {
      data = try await executeData(
        method, path: path, body: body, token: token,
        authorizationScheme: authorizationScheme, contentType: contentType, headers: headers)
    }
    guard requestSession == sessionRevision else { throw CancellationError() }
    return try JSONDecoder().decode(Response.self, from: data)
  }

  private func executeData(
    _ method: String, path: String, body: Data?,
    token: String?, authorizationScheme: String = "Bearer",
    contentType: String = "application/json", headers: [String: String] = [:]
  ) async throws -> Data {
    try checkServerCooldown()
    let revision = sessionRevision
    guard path.hasPrefix("/v1/"), let url = URL(string: path, relativeTo: origin)?.absoluteURL,
      url.host == origin.host, url.scheme == "https"
    else { throw CompetitionTransportError.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("\(installedBuild)", forHTTPHeaderField: "X-Folding-Build")
    request.httpBody = body
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let uploadDiagnostics {
      request.setValue(uploadDiagnostics.worker, forHTTPHeaderField: "X-Folding-Upload-Worker")
      request.setValue(uploadDiagnostics.queue, forHTTPHeaderField: "X-Folding-Upload-Queue")
    }
    if let token {
      request.setValue("\(authorizationScheme) \(token)", forHTTPHeaderField: "Authorization")
    }
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    let started = ProcessInfo.processInfo.systemUptime
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: request) } catch {
      recordNetwork(path, started: started, error: error)
      throw error
    }
    guard revision == sessionRevision else { throw CancellationError() }
    guard let http = response as? HTTPURLResponse else {
      throw CompetitionTransportError.invalidResponse
    }
    recordNetwork(
      path, started: started, data: data, status: http.statusCode,
      requestID: http.value(forHTTPHeaderField: "X-Request-ID").flatMap(UUID.init(uuidString:)))
    guard (200..<300).contains(http.statusCode) else {
      let failure = try? JSONDecoder().decode(CompetitionServiceFailure.self, from: data)
      if http.statusCode == 426, failure?.code == "app_update_required",
        let minimum = failure?.minimumBuild, minimum > installedBuild, minimum <= Int(Int32.max)
      {
        await onUpdateRequired(minimum)
      }
      try rememberServerCooldown(http, fallback: failure?.retryAfterSeconds.map(TimeInterval.init))
      if http.statusCode == 401 { throw CompetitionTransportError.unauthorized }
      if let failure {
        let retryAfter =
          http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
          ?? failure.retryAfterSeconds.map(TimeInterval.init)
        throw CompetitionTransportError.service(
          status: http.statusCode, code: failure.code,
          retryable: failure.retryable ?? (http.statusCode >= 500 || http.statusCode == 429),
          retryAfter: retryAfter)
      }
      throw CompetitionTransportError.server(http.statusCode)
    }
    guard data.count <= 2 * 1024 * 1024 else { throw CompetitionTransportError.invalidResponse }
    return data
  }

  private func checkServerCooldown() throws {
    guard let data = try credentials.read("server-cooldown") else { return }
    let cooldown = try JSONDecoder().decode(ServerCooldown.self, from: data)
    let remaining = Double(cooldown.untilMS - nowMS()) / 1000
    guard remaining > 0 else { return }
    throw CompetitionTransportError.service(
      status: cooldown.status,
      code: cooldown.status == 429 ? "rate_limited" : "temporarily_unavailable",
      retryable: true, retryAfter: remaining)
  }

  // Covers JSON API errors and non-JSON edge responses. The persisted origin-wide
  // cooldown also applies after relaunch/sign-out and to authenticated image reads.
  private func rememberServerCooldown(_ response: HTTPURLResponse, fallback: TimeInterval? = nil)
    throws
  {
    guard [429, 503].contains(response.statusCode) else { return }
    let now = nowMS()
    let delay = Self.serverRetryDelay(
      response.value(forHTTPHeaderField: "Retry-After"), fallback: fallback,
      status: response.statusCode, nowMS: now)
    guard let delay, delay > 0 else { return }
    let deadline = now + Int64((delay * 1000).rounded(.up))
    if let existing = try credentials.read("server-cooldown"),
      let cooldown = try? JSONDecoder().decode(ServerCooldown.self, from: existing),
      cooldown.untilMS >= deadline
    {
      return
    }
    try credentials.write(
      Self.encode(ServerCooldown(untilMS: deadline, status: response.statusCode)),
      account: "server-cooldown")
  }

  static func serverRetryDelay(
    _ header: String?, fallback: TimeInterval?, status: Int, nowMS: Int64
  ) -> TimeInterval? {
    var delay: TimeInterval?
    if let header {
      let value = header.trimmingCharacters(in: .whitespacesAndNewlines)
      if let seconds = TimeInterval(value), seconds.isFinite, seconds >= 0 {
        delay = seconds
      } else {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        if let date = formatter.date(from: value) {
          delay = max(0, date.timeIntervalSince1970 - Double(nowMS) / 1000)
        }
      }
    }
    if delay == nil, let fallback, fallback.isFinite, fallback >= 0 { delay = fallback }
    if delay == nil, status == 429 { delay = 60 }
    return delay.map { min($0, 86400) }
  }

  func saveRemoval(_ value: CompetitionRemovalOperation) throws {
    try credentials.write(Self.encode(value), account: "removal")
  }
  func pendingRemoval() throws -> CompetitionRemovalOperation? {
    guard let data = try credentials.read("removal") else { return nil }
    if let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      value["kind"] as? String == "leave"
    {
      try credentials.remove("removal")
      return nil
    }
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
    try checkServerCooldown()
    let revision = sessionRevision
    guard UUID(uuidString: id) != nil,
      let url = URL(string: "/v1/avatars/\(id)/image", relativeTo: origin)?.absoluteURL
    else { throw CompetitionTransportError.invalidResponse }
    var request = URLRequest(url: url)
    request.setValue("\(installedBuild)", forHTTPHeaderField: "X-Folding-Build")
    request.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
    let (bytes, response) = try await session.bytes(for: request)
    if let http = response as? HTTPURLResponse {
      if http.statusCode == 426,
        let value = http.value(forHTTPHeaderField: "X-Folding-Minimum-Build"),
        let minimum = Int(value), minimum > installedBuild, minimum <= Int(Int32.max)
      {
        await onUpdateRequired(minimum)
      }
      try rememberServerCooldown(http)
    }
    guard let http = response as? HTTPURLResponse, http.statusCode == 200,
      http.mimeType == "image/jpeg"
    else { throw CompetitionTransportError.invalidResponse }
    var data = Data()
    for try await byte in bytes {
      guard data.count < 512 * 1024 else { throw CompetitionTransportError.invalidResponse }
      data.append(byte)
    }
    guard revision == sessionRevision else { throw CancellationError() }
    return data
  }
}

actor CompetitionTransportPool {
  static let shared = CompetitionTransportPool()
  private var clients: [String: CompetitionTransport] = [:]
  func client(origin: URL, deployment: String, deviceID: UUID, bundleID: String) throws
    -> CompetitionTransport
  {
    let key = "\(bundleID)|\(deployment)|\(origin.absoluteString)|\(deviceID)"
    if let client = clients[key] { return client }
    let client = try CompetitionTransport(
      origin: origin, deployment: deployment, deviceID: deviceID, bundleID: bundleID)
    clients[key] = client
    return client
  }
}
