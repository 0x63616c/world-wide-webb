import DeviceCheck
import Foundation
import XCTest

@testable import Folding

private actor AttestationProbe: CompetitionAttestation {
  nonisolated var isSupported: Bool { true }
  var proofs = 0
  var keys = 0
  func generateKey() async throws -> String {
    keys += 1
    return "test-key-\(keys)"
  }
  func attestKey(_ key: String, clientDataHash: Data) async throws -> Data {
    proofs += 1
    return Data("proof".utf8)
  }
  func generateAssertion(_ key: String, clientDataHash: Data) async throws -> Data {
    Data("assertion".utf8)
  }
}

private final class EnrollmentProtocol: URLProtocol, @unchecked Sendable {
  static let lock = NSLock()
  nonisolated(unsafe) static var enrollmentBodies: [Data] = []
  nonisolated(unsafe) static var loseResponse = true
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let path = request.url!.path
    let object: [String: Any]
    if path == "/v1/attestation/challenges" {
      object = [
        "challenge_id": "00000000-0000-4000-8000-000000000001",
        "nonce": Data(repeating: 1, count: 32).base64EncodedString(), "expires_at_ms": 1,
      ]
    } else if path == "/v1/attestation/keys" {
      var body = request.httpBody ?? Data()
      if let stream = request.httpBodyStream {
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
          let count = stream.read(&buffer, maxLength: buffer.count)
          if count <= 0 { break }
          body.append(contentsOf: buffer.prefix(count))
        }
      }
      let lost = Self.lock.withLock {
        Self.enrollmentBodies.append(body)
        let value = Self.loseResponse
        Self.loseResponse = false
        return value
      }
      if lost {
        client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
        return
      }
      object = ["key_id": "test-key-1", "enrolled": true]
    } else {
      client?.urlProtocol(self, didFailWithError: URLError(.badURL))
      return
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: object))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

final class CompetitionTransportTests: XCTestCase {
  func testRetiredLeaveCannotBecomeAccountDeletionAndDeletionSurvivesRestart() async throws {
    let bundle = "app.getfolding.tests.\(UUID())"
    let credentials = CompetitionCredentialStore(service: "\(bundle).competition.production")
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
      deviceID: UUID(), bundleID: bundle, attestation: AttestationProbe())
    defer { try? credentials.remove("removal") }
    let legacy: [String: Any] = [
      "kind": "leave", "operationID": UUID().uuidString.lowercased(), "accepted": false,
    ]
    try credentials.write(JSONSerialization.data(withJSONObject: legacy), account: "removal")
    let retired = try await transport.pendingRemoval()
    XCTAssertNil(retired)
    XCTAssertNil(try credentials.read("removal"))
    let deletion = CompetitionRemovalOperation(
      kind: .delete, operationID: UUID().uuidString.lowercased(), accepted: false,
      deletionReceipt: nil)
    try await transport.saveRemoval(deletion)
    let restored = try await transport.pendingRemoval()
    XCTAssertEqual(restored?.operationID, deletion.operationID)
  }

  func testEnrollmentResponseLossReplaysPersistedProofAcrossTransportRestart() async throws {
    EnrollmentProtocol.lock.withLock {
      EnrollmentProtocol.enrollmentBodies = []
      EnrollmentProtocol.loseResponse = true
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [EnrollmentProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let bundle = "app.getfolding.tests.\(UUID().uuidString)"
    let device = UUID()
    let probe = AttestationProbe()
    func transport() throws -> CompetitionTransport {
      try CompetitionTransport(
        origin: URL(string: "https://api.getfolding.app")!,
        deployment: "production", deviceID: device, bundleID: bundle,
        session: session, attestation: probe)
    }
    let first = try transport()
    try await first.saveSession(
      CompetitionSession(access_token: "test", refresh_token: "test", expires_at_ms: Int64.max))
    do {
      _ = try await first.enrollKey()
      XCTFail("Expected lost response")
    } catch is URLError {}
    let restarted = try transport()
    let key = try await restarted.enrollKey()
    XCTAssertEqual(key, "test-key-1")
    let proofs = await probe.proofs
    XCTAssertEqual(proofs, 1)
    let bodies = EnrollmentProtocol.lock.withLock { EnrollmentProtocol.enrollmentBodies }
    XCTAssertEqual(bodies.count, 2)
    XCTAssertEqual(bodies.first, bodies.last)
    try await restarted.clearSession()
  }

  func testStaleSignInCannotRestoreClearedSession() async throws {
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!,
      deployment: "production", deviceID: UUID(), bundleID: "app.getfolding.tests.\(UUID())")
    let context = await transport.sessionContext()
    try await transport.clearSession()
    do {
      try await transport.replaceSession(
        CompetitionSession(access_token: "old", refresh_token: "old", expires_at_ms: 100),
        context: context)
      XCTFail("Stale account restored")
    } catch is CancellationError {}
  }
}

private final class ResourceClock: @unchecked Sendable {
  let lock = NSLock()
  var value: Int64 = 1_800_000_000_000
  func now() -> Int64 { lock.withLock { value } }
  func advance(_ milliseconds: Int64) { lock.withLock { value += milliseconds } }
}
private final class ResourceProtocol: URLProtocol, @unchecked Sendable {
  static let lock = NSLock()
  nonisolated(unsafe) static var requests = 0
  nonisolated(unsafe) static var limited = true
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let limited = Self.lock.withLock {
      Self.requests += 1
      return Self.limited
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: limited ? 429 : 200,
      httpVersion: nil,
      headerFields: limited
        ? ["Retry-After": "60", "Content-Type": "text/html"] : ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data((limited ? "slow down" : "{\"value\":1}").utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
extension CompetitionTransportTests {
  func testServerCooldownSurvivesRestartAndSignoutAndReadCacheExpires() async throws {
    ResourceProtocol.lock.withLock {
      ResourceProtocol.requests = 0
      ResourceProtocol.limited = true
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ResourceProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let clock = ResourceClock()
    let bundle = "app.getfolding.tests.\(UUID().uuidString)"
    let credentials = CompetitionCredentialStore(service: "\(bundle).competition.production")
    defer { try? credentials.remove("server-cooldown") }
    func transport() throws -> CompetitionTransport {
      try CompetitionTransport(
        origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
        deviceID: UUID(), bundleID: bundle, session: session, nowMS: { clock.now() })
    }
    struct Value: Decodable, Sendable { let value: Int }
    let first = try transport()
    do {
      let _: Value = try await first.send("GET", path: "/v1/me", authenticated: false)
      XCTFail("Expected rate limit")
    } catch let error as CompetitionTransportError { XCTAssertEqual(error.statusCode, 429) }
    let restarted = try transport()
    try await restarted.clearSession()
    do {
      let _: Value = try await restarted.send("GET", path: "/v1/me", authenticated: false)
      XCTFail("Expected persisted cooldown")
    } catch let error as CompetitionTransportError { XCTAssertEqual(error.statusCode, 429) }
    do {
      _ = try await restarted.avatarImage(UUID().uuidString)
      XCTFail("Expected image cooldown before authentication")
    } catch let error as CompetitionTransportError { XCTAssertEqual(error.statusCode, 429) }
    XCTAssertEqual(ResourceProtocol.lock.withLock { ResourceProtocol.requests }, 1)
    clock.advance(60_001)
    ResourceProtocol.lock.withLock { ResourceProtocol.limited = false }
    try await restarted.saveSession(
      CompetitionSession(
        access_token: "synthetic", refresh_token: "synthetic", expires_at_ms: Int64.max))
    async let a: Value = restarted.send("GET", path: "/v1/leaderboards?kind=week")
    async let b: Value = restarted.send("GET", path: "/v1/leaderboards?kind=week")
    _ = try await (a, b)
    let _: Value = try await restarted.send("GET", path: "/v1/leaderboards?kind=week")
    XCTAssertEqual(ResourceProtocol.lock.withLock { ResourceProtocol.requests }, 2)
    clock.advance(15_001)
    let _: Value = try await restarted.send("GET", path: "/v1/leaderboards?kind=week")
    XCTAssertEqual(ResourceProtocol.lock.withLock { ResourceProtocol.requests }, 3)
    let _: Value = try await restarted.send("PATCH", path: "/v1/profile", body: Data("{}".utf8))
    let _: Value = try await restarted.send("GET", path: "/v1/leaderboards?kind=week")
    XCTAssertEqual(ResourceProtocol.lock.withLock { ResourceProtocol.requests }, 5)
    try await restarted.clearSession()
  }
  func testRetryAfterDatesFallbackAndBounds() {
    XCTAssertEqual(
      CompetitionTransport.serverRetryDelay(
        "Thu, 01 Jan 1970 00:02:00 GMT", fallback: nil, status: 503, nowMS: 60_000), 60)
    XCTAssertEqual(
      CompetitionTransport.serverRetryDelay("NaN", fallback: nil, status: 429, nowMS: 0), 60)
    XCTAssertEqual(
      CompetitionTransport.serverRetryDelay("-1", fallback: 90, status: 429, nowMS: 0), 90)
    XCTAssertEqual(
      CompetitionTransport.serverRetryDelay("1e100", fallback: nil, status: 429, nowMS: 0), 86400)
    XCTAssertNil(CompetitionTransport.serverRetryDelay(nil, fallback: nil, status: 503, nowMS: 0))
  }
}

/// Hold a successful identity response until after the block mutation has completed.
private final class DelayedIdentityProtocol: URLProtocol, @unchecked Sendable {
  static let lock = NSLock()
  nonisolated(unsafe) static var waiting: [DelayedIdentityProtocol] = []
  nonisolated(unsafe) static var started: XCTestExpectation?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    if request.httpMethod == "PUT" {
      finish(Data(#"{"blocked":true}"#.utf8), mime: "application/json")
    } else {
      let expectation = Self.lock.withLock {
        Self.waiting.append(self)
        return Self.started
      }
      expectation?.fulfill()
    }
  }
  override func stopLoading() {}
  func finish(_ data: Data, mime: String) {
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": mime])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
}

@MainActor final class BlockVisibilityTests: XCTestCase {
  func testDelayedBoardProfileAndAvatarCannotRestoreBlockedIdentity() async throws {
    let started = expectation(description: "Identity reads started")
    started.expectedFulfillmentCount = 3
    DelayedIdentityProtocol.lock.withLock {
      DelayedIdentityProtocol.waiting = []
      DelayedIdentityProtocol.started = started
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [DelayedIdentityProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
      deviceID: UUID(), bundleID: "app.getfolding.tests.\(UUID())", session: session)
    try await transport.saveSession(
      CompetitionSession(
        access_token: "synthetic", refresh_token: "synthetic", expires_at_ms: Int64.max))
    defer {
      DelayedIdentityProtocol.lock.withLock {
        DelayedIdentityProtocol.started = nil
        DelayedIdentityProtocol.waiting = []
      }
    }
    struct Identity: Decodable, Sendable { let nickname: String }
    let board = Task {
      let _: Identity = try await transport.send("GET", path: "/v1/leaderboards?kind=all")
    }
    let profile = Task {
      let _: Identity = try await transport.send("GET", path: "/v1/participants/\(UUID())")
    }
    let avatar = Task { _ = try await transport.avatarImage(UUID().uuidString.lowercased()) }
    await fulfillment(of: [started], timeout: 5)
    struct Block: Decodable, Sendable { let blocked: Bool }
    let _: Block = try await transport.send(
      "PUT", path: "/v1/blocks/\(UUID())", body: Data("{}".utf8))
    let waiting = DelayedIdentityProtocol.lock.withLock { DelayedIdentityProtocol.waiting }
    for request in waiting {
      let image = request.request.url!.path.hasSuffix("/image")
      request.finish(
        image ? Data([1, 2, 3]) : Data(#"{"nickname":"Hidden name"}"#.utf8),
        mime: image ? "image/jpeg" : "application/json")
    }
    for result in [await board.result, await profile.result, await avatar.result] {
      switch result {
      case .success: XCTFail("A stale identity response escaped the visibility fence")
      case .failure(let error): XCTAssertTrue(error is CancellationError, "\(error)")
      }
    }
    try await transport.clearSession()
  }
}

@MainActor private final class ExpiredDeletionAuthorization: CompetitionAccountAuthorizing {
  let status: Int
  var existingOnlyAttempts: [Bool] = []
  init(status: Int) { self.status = status }
  func recoverDeletion(transport: CompetitionTransport, deviceID: UUID, operationID: String)
    async throws -> CompetitionDeletionReceipt
  {
    throw CompetitionTransportError.server(status)
  }
  func reauthenticate(transport: CompetitionTransport, deviceID: UUID) async throws -> String {
    throw CompetitionTransportError.unauthorized
  }
  func signIn(
    transport: CompetitionTransport, deviceID: UUID, existingParticipantID: String?,
    existingAccountOnly: Bool
  ) async throws -> CompetitionSignInResult {
    existingOnlyAttempts.append(existingAccountOnly)
    throw CompetitionTransportError.server(404)
  }
}

@MainActor final class DeletionRecoveryTests: XCTestCase {
  func testLostAcceptedResponseAfterRetentionShowsUnverifiedStatusWithoutRecreatingAccount()
    async throws
  {
    for status in [401, 404] {
      let device = UUID()
      let transport = try CompetitionTransport(
        origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
        deviceID: device, bundleID: "app.getfolding.tests.\(UUID())")
      let operation = CompetitionRemovalOperation(
        kind: .delete, operationID: UUID().uuidString.lowercased(), accepted: false,
        deletionReceipt: nil)
      // Server accepted the request, but its response was lost; this is the exact durable client state.
      try await transport.saveRemoval(operation)
      let authorization = ExpiredDeletionAuthorization(status: status)
      let suite = "folding.deletion.tests.\(UUID())"
      let defaults = UserDefaults(suiteName: suite)!
      defer { defaults.removePersistentDomain(forName: suite) }
      let controller = AppController(
        preferencesStore: defaults,
        competitionAPI: CompetitionAPI(transport: transport, deviceID: device),
        appleSignIn: authorization)
      try await controller.pollRemoval(allowRecovery: true)
      XCTAssertEqual(controller.presentation.competitionRemoval, .statusUnavailable)
      let saved = try await transport.pendingRemoval()
      XCTAssertEqual(saved?.operationID, operation.operationID)
      XCTAssertEqual(saved?.accepted, false)
      XCTAssertEqual(authorization.existingOnlyAttempts, status == 404 ? [true] : [])
      try await transport.finishRemoval()
      try await transport.clearSession()
    }
  }
}
