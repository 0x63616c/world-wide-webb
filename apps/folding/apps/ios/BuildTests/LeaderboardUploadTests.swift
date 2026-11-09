import FoldingData
import FoldingDomain
import Foundation
import XCTest

@testable import Folding

private struct UploadTestProof: CompetitionAttestation {
  var isSupported: Bool { true }
  func generateKey() async throws -> String { "fixture-key" }
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

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let path = request.url!.path
      Self.lock.withLock { Self.routes.append(path) }
      let response: [String: Any]
      if path == "/v1/attestation/challenges" {
        response = [
          "challenge_id": UUID().uuidString.lowercased(), "nonce": "fixture-nonce",
          "expires_at_ms": Int64(Date().timeIntervalSince1970 * 1000) + 60_000,
        ]
      } else if ["/v1/event-batches", "/v1/history-batches"].contains(path) {
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
