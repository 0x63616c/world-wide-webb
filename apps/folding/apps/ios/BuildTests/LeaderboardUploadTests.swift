import FoldingData
import FoldingDomain
import Foundation
import XCTest

@testable import Folding

private actor UploadKeyGate {
  private var continuation: CheckedContinuation<Void, Never>?
  private var released = false
  func wait() async { if !released { await withCheckedContinuation { continuation = $0 } } }
  func release() {
    released = true
    continuation?.resume()
    continuation = nil
  }
}

private struct UploadTestProof: CompetitionAttestation {
  var keyGenerated: (@Sendable () -> Void)? = nil
  var keyGate: UploadKeyGate? = nil
  var isSupported: Bool { true }
  func generateKey() async throws -> String {
    keyGenerated?()
    await keyGate?.wait()
    return "fixture-key"
  }
  func attestKey(_ key: String, clientDataHash: Data) async throws -> Data { Data("proof".utf8) }
  func generateAssertion(_ key: String, clientDataHash: Data) async throws -> Data {
    Data("assertion".utf8)
  }
}

private final class UploadBoardProtocol: URLProtocol, @unchecked Sendable {
  static let lock = NSLock()
  nonisolated(unsafe) static var score = 21
  nonisolated(unsafe) static var acceptedIDs = Set<String>()
  nonisolated(unsafe) static var routes: [String] = []
  nonisolated(unsafe) static var operations: [String] = []
  nonisolated(unsafe) static var forcedBatchStatus: Int?
  nonisolated(unsafe) static var forcedRetryAfter: Int?
  nonisolated(unsafe) static var heldRefresh: UploadBoardProtocol?
  nonisolated(unsafe) static var refreshStarted: (@Sendable () -> Void)?

  static func releaseRefresh() {
    let pending = lock.withLock {
      let value = heldRefresh
      heldRefresh = nil
      return value
    }
    pending?.respond([
      "access_token": "fixture-token", "refresh_token": "fixture-refresh",
      "expires_at_ms": Int64.max,
    ])
  }

  private func respond(_ response: [String: Any], status: Int = 200, retryAfter: Int? = nil) {
    var headers = ["Content-Type": "application/json"]
    if let retryAfter { headers["Retry-After"] = String(retryAfter) }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil,
        headerFields: headers)!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: response))
    client?.urlProtocolDidFinishLoading(self)
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let path = request.url!.path
      Self.lock.withLock { Self.routes.append(path) }
      let response: [String: Any]
      if path == "/v1/auth/refresh" {
        Self.lock.withLock { Self.heldRefresh = self }
        Self.refreshStarted?()
        return
      } else if path == "/v1/me" {
        response = [:]
      } else if path == "/v1/attestation/keys" {
        response = ["key_id": "fixture-key", "enrolled": true]
      } else if path == "/v1/attestation/challenges" {
        response = [
          "challenge_id": UUID().uuidString.lowercased(),
          "nonce": Data(repeating: 1, count: 32).base64EncodedString(),
          "expires_at_ms": Int64(Date().timeIntervalSince1970 * 1000) + 60_000,
        ]
      } else if ["/v1/event-batches", "/v1/history-batches"].contains(path) {
        if let status = Self.lock.withLock({ Self.forcedBatchStatus }) {
          respond(
            ["code": status == 429 ? "rate_limited" : "service_unavailable", "retryable": true],
            status: status, retryAfter: Self.lock.withLock { Self.forcedRetryAfter })
          return
        }
        let batch = try XCTUnwrap(
          JSONSerialization.jsonObject(with: body()) as? [String: Any])
        let events = try XCTUnwrap(batch["events"] as? [[String: Any]])
        let operation = try XCTUnwrap(batch["operation_id"] as? String)
        let decisions = try events.map { event -> [String: Any] in
          let id = try XCTUnwrap(event["event_id"] as? String)
          if path == "/v1/history-batches" {
            XCTAssertTrue(event["competition_epoch_id"] is NSNull)
          }
          let fresh = Self.lock.withLock { Self.acceptedIDs.insert(id).inserted }
          if fresh { Self.lock.withLock { Self.score += 1 } }
          return ["event_id": id, "disposition": fresh ? "accepted" : "duplicate"]
        }
        Self.lock.withLock { Self.operations.append(operation) }
        response = ["operation_id": operation, "events": decisions]
      } else if path == "/v1/leaderboards" {
        let score = Self.lock.withLock { Self.score }
        let row: [String: Any] = [
          "participant_id": "00000000-0000-4000-8000-000000000001", "nickname": "Fixture",
          "avatar_id": NSNull(), "folds": score, "rank": 1, "medal": NSNull(),
        ]
        response = [
          "period": ["id": "all", "kind": "all", "state": "live"],
          "page": [
            "items": [row], "next_cursor": NSNull(), "snapshot_version": "fixture-\(score)",
          ],
          "you": row, "population": 1,
        ]
      } else {
        throw URLError(.badURL)
      }
      client?.urlProtocol(
        self,
        didReceive: HTTPURLResponse(
          url: request.url!, statusCode: 200, httpVersion: nil,
          headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: response))
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  private func body() throws -> Data {
    if let body = request.httpBody { return body }
    let stream = try XCTUnwrap(request.httpBodyStream)
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count <= 0 { break }
      data.append(contentsOf: buffer.prefix(count))
    }
    return data
  }
  override func stopLoading() {}
}

@MainActor final class LeaderboardUploadTests: XCTestCase {
  func testUploadWaitsForConcurrentSessionRefreshInsteadOfHourBackoff() async throws {
    let refreshing = expectation(description: "account read refreshing session")
    let generating = expectation(description: "upload begins key enrollment")
    let premature = expectation(description: "upload must wait for the existing session refresh")
    premature.isInverted = true
    UploadBoardProtocol.lock.withLock {
      UploadBoardProtocol.score = 21
      UploadBoardProtocol.acceptedIDs = []
      UploadBoardProtocol.routes = []
      UploadBoardProtocol.operations = []
      UploadBoardProtocol.heldRefresh = nil
      UploadBoardProtocol.refreshStarted = { refreshing.fulfill() }
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [UploadBoardProtocol.self]
    let session = URLSession(configuration: config)
    let bundle = "app.getfolding.refresh-fixture.\(UUID())"
    let credentials = CompetitionCredentialStore(service: "\(bundle).competition.production")
    defer {
      session.invalidateAndCancel()
      UploadBoardProtocol.releaseRefresh()
      UploadBoardProtocol.lock.withLock { UploadBoardProtocol.refreshStarted = nil }
      for key in [
        "session", "refresh-operation", "attest-key", "attest-pending", "attest-enrolled",
      ] {
        try? credentials.remove(key)
      }
      try? FileManager.default.removeItem(at: directory)
    }
    let device = UUID()
    let epoch = UUID()
    let now = TrackingRuntime.nowMS
    let store = try TrackingStore(directory: directory, installationID: device)
    try await store.setCompetitionEpoch(epoch)
    _ = try await store.record(
      Observation(
        generation: .initial, transition: .open, observedAtMS: now - 200_000,
        timezoneID: "UTC", competitionEpochID: epoch), nowMS: now - 200_000)
    for _ in 0..<19 {
      let leased = try await store.leaseCompetitionUpload(nowMS: now - 100_000)
      let work = try XCTUnwrap(leased)
      try await store.retryCompetitionUpload(work, atMS: now - 100_000)
    }
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
      deviceID: device, bundleID: bundle, session: session,
      attestation: UploadTestProof(keyGenerated: { generating.fulfill() }))
    try await transport.saveSession(
      CompetitionSession(
        access_token: "expired-fixture", refresh_token: "fixture-refresh", expires_at_ms: now - 1))
    struct Read: Decodable, Sendable {}
    let account = Task { let _: Read = try await transport.send("GET", path: "/v1/me") }
    await fulfillment(of: [refreshing], timeout: 2)
    let uploader = Task {
      let result = await CompetitionUploader().upload(from: store, transport: transport)
      if UploadBoardProtocol.lock.withLock({ UploadBoardProtocol.heldRefresh != nil }) {
        premature.fulfill()
      }
      return result
    }
    await fulfillment(of: [generating], timeout: 2)
    await fulfillment(of: [premature], timeout: 0.25)
    UploadBoardProtocol.releaseRefresh()
    try await account.value
    let result = await uploader.value
    XCTAssertEqual(result, .accepted)
    let pending = try await store.pendingCompetitionEventCount()
    XCTAssertEqual(pending, 0)
    XCTAssertEqual(UploadBoardProtocol.lock.withLock { UploadBoardProtocol.score }, 22)
    XCTAssertEqual(
      UploadBoardProtocol.lock.withLock {
        UploadBoardProtocol.routes.filter { $0 == "/v1/auth/refresh" }.count
      }, 1)
  }

  func testLocalSigningBusyRetriesInSecondsWithoutPenaltyOrChangingOperation() async throws {
    let generating = expectation(description: "enrollment holds signing")
    let gate = UploadKeyGate()
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let bundle = "app.getfolding.busy-fixture.\(UUID())"
    let credentials = CompetitionCredentialStore(service: "\(bundle).competition.production")
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [UploadBoardProtocol.self]
    let session = URLSession(configuration: config)
    defer {
      session.invalidateAndCancel()
      try? FileManager.default.removeItem(at: directory)
      for key in ["session", "attest-key", "attest-pending", "attest-enrolled"] {
        try? credentials.remove(key)
      }
    }
    let device = UUID()
    let epoch = UUID()
    let now = TrackingRuntime.nowMS
    let store = try TrackingStore(directory: directory, installationID: device)
    try await store.setCompetitionEpoch(epoch)
    _ = try await store.record(
      Observation(
        generation: .initial, transition: .open,
        observedAtMS: now - 200_000, timezoneID: "UTC", competitionEpochID: epoch),
      nowMS: now - 200_000)
    var original: CompetitionUpload?
    for _ in 0..<3 {
      let leased = try await store.leaseCompetitionUpload(nowMS: now - 100_000)
      let work = try XCTUnwrap(leased)
      original = work
      try await store.retryCompetitionUpload(work, atMS: now - 100_000)
    }
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!,
      deployment: "production", deviceID: device, bundleID: bundle, session: session,
      attestation: UploadTestProof(keyGenerated: { generating.fulfill() }, keyGate: gate))
    try await transport.saveSession(
      CompetitionSession(
        access_token: "fixture", refresh_token: "fixture", expires_at_ms: Int64.max))
    let enrolling = Task { try await transport.enrollKey() }
    await fulfillment(of: [generating], timeout: 2)
    let result = await CompetitionUploader().upload(from: store, transport: transport)
    XCTAssertEqual(result, .deferred)
    let leased = try await store.leaseCompetitionUpload(nowMS: TrackingRuntime.nowMS + 5_000)
    let retried = try XCTUnwrap(leased)
    XCTAssertEqual(retried.attempts, 3)
    XCTAssertEqual(retried.operationID, original?.operationID)
    XCTAssertEqual(retried.body, original?.body)
    let snapshot = try await store.diagnosticSnapshot(nowMS: TrackingRuntime.nowMS)
    let retry = try XCTUnwrap(snapshot.events.last { $0.event == .uploadRetryScheduled })
    XCTAssertEqual(retry.attempt, 3)
    XCTAssertEqual(retry.retryDelayMS, 2_000)
    XCTAssertEqual(retry.reason, .busy)
    await gate.release()
    _ = try await enrolling.value
  }

  func testServiceBackoffIsBoundedAndServerRetryAfterIsPreserved() async throws {
    for (status, retryAfter) in [(503, nil as Int?), (429, 600)] {
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
        UUID().uuidString)
      let bundle = "app.getfolding.backoff-fixture.\(UUID())"
      let credentials = CompetitionCredentialStore(service: "\(bundle).competition.production")
      let config = URLSessionConfiguration.ephemeral
      config.protocolClasses = [UploadBoardProtocol.self]
      let session = URLSession(configuration: config)
      defer {
        session.invalidateAndCancel()
        try? FileManager.default.removeItem(at: directory)
        for key in ["session", "attest-enrolled"] { try? credentials.remove(key) }
        UploadBoardProtocol.lock.withLock {
          UploadBoardProtocol.forcedBatchStatus = nil
          UploadBoardProtocol.forcedRetryAfter = nil
        }
      }
      let device = UUID()
      let epoch = UUID()
      let now = TrackingRuntime.nowMS
      let store = try TrackingStore(directory: directory, installationID: device)
      try await store.setCompetitionEpoch(epoch)
      _ = try await store.record(
        Observation(
          generation: .initial, transition: .open,
          observedAtMS: now - 200_000, timezoneID: "UTC", competitionEpochID: epoch),
        nowMS: now - 200_000)
      var original: CompetitionUpload?
      for _ in 0..<20 {
        let leased = try await store.leaseCompetitionUpload(nowMS: now - 100_000)
        let work = try XCTUnwrap(leased)
        original = work
        try await store.retryCompetitionUpload(work, atMS: now - 100_000)
      }
      let transport = try CompetitionTransport(
        origin: URL(string: "https://api.getfolding.app")!,
        deployment: "production", deviceID: device, bundleID: bundle, session: session,
        attestation: UploadTestProof())
      try await transport.saveSession(
        CompetitionSession(
          access_token: "fixture", refresh_token: "fixture", expires_at_ms: Int64.max))
      try credentials.write(Data("fixture-key".utf8), account: "attest-enrolled")
      UploadBoardProtocol.lock.withLock {
        UploadBoardProtocol.forcedBatchStatus = status
        UploadBoardProtocol.forcedRetryAfter = retryAfter
      }
      let result = await CompetitionUploader().upload(from: store, transport: transport)
      XCTAssertEqual(result, .deferred)
      let soon = try await store.competitionUploadQueueState(nowMS: TrackingRuntime.nowMS + 360_000)
      XCTAssertEqual(soon, status == 429 ? .retryWait : .ready)
      let leased = try await store.leaseCompetitionUpload(nowMS: TrackingRuntime.nowMS + 700_000)
      let retried = try XCTUnwrap(leased)
      XCTAssertEqual(retried.operationID, original?.operationID)
      XCTAssertEqual(retried.body, original?.body)
    }
  }

  func testRefreshUploadsQueuedLiveAndOriginalHistoryBeforeReadingScore() async throws {
    UploadBoardProtocol.lock.withLock {
      UploadBoardProtocol.score = 21
      UploadBoardProtocol.acceptedIDs = []
      UploadBoardProtocol.routes = []
      UploadBoardProtocol.operations = []
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.upload.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let device = UUID()
    let epoch = UUID()
    let now = TrackingRuntime.nowMS
    let store = try TrackingStore(directory: directory, installationID: device)
    func record(_ count: Int, at start: Int64, epoch: UUID?, startsOpen: Bool) async throws {
      for index in 0..<count {
        _ = try await store.record(
          Observation(
            generation: .initial,
            transition: index.isMultiple(of: 2) == startsOpen ? .open : .close,
            observedAtMS: start + Int64(index), timezoneID: "UTC", competitionEpochID: epoch),
          nowMS: start + Int64(index))
      }
    }
    try await record(32, at: now - 500_000, epoch: nil, startsOpen: true)
    try await store.setCompetitionEpoch(epoch)
    try await record(21, at: now - 400_000, epoch: epoch, startsOpen: true)
    let acceptedWork = try await store.leaseCompetitionUpload(nowMS: now - 300_000)
    let accepted = try XCTUnwrap(acceptedWork)
    try await store.acknowledgeCompetitionUpload(
      accepted, dispositions: Array(repeating: "accepted", count: 21))
    try await record(34, at: now - 200_000, epoch: epoch, startsOpen: false)
    let pendingWork = try await store.leaseCompetitionUpload(nowMS: now - 100_000)
    let pending = try XCTUnwrap(pendingWork)
    try await store.configureCompetitionHistory(beforeJoinedAtMS: now - 450_000)

    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [UploadBoardProtocol.self]
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    let bundle = "app.getfolding.fixture.\(UUID())"
    let credentials = CompetitionCredentialStore(service: "\(bundle).competition.production")
    defer { for key in ["session", "attest-enrolled"] { try? credentials.remove(key) } }
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
      deviceID: device, bundleID: bundle, session: session, attestation: UploadTestProof())
    try await transport.saveSession(
      CompetitionSession(
        access_token: "fixture-token", refresh_token: "fixture-refresh",
        expires_at_ms: now + 3_600_000))
    try credentials.write(Data("fixture-key".utf8), account: "attest-enrolled")
    let runtime = TrackingRuntime(journal: store)
    let controller = AppController(
      runtime: runtime, preferencesStore: defaults,
      competitionAPI: CompetitionAPI(transport: transport, deviceID: device))

    // No lifecycle/background loop is started: a refresh must drive the real uploader itself.
    let load = try XCTUnwrap(controller.actions.loadLeaderboard)
    let first = try await load(.all)
    XCTAssertEqual(first.currentUser?.folds, 55)
    XCTAssertEqual(
      UploadBoardProtocol.lock.withLock { UploadBoardProtocol.operations.first },
      pending.operationID.uuidString.lowercased())
    let second = try await load(.all)
    XCTAssertEqual(second.currentUser?.folds, 87)
    let personal = try await store.summary()
    XCTAssertEqual(personal.folds, 87)
    XCTAssertEqual(
      UploadBoardProtocol.lock.withLock { UploadBoardProtocol.routes },
      [
        "/v1/attestation/challenges", "/v1/event-batches", "/v1/leaderboards",
        "/v1/attestation/challenges", "/v1/history-batches", "/v1/leaderboards",
      ])
  }
}
