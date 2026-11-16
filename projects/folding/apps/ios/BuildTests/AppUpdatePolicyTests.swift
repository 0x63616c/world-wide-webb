import FoldingData
import FoldingDomain
import Foundation
import XCTest

@testable import Folding

private final class PolicyProtocol: URLProtocol, @unchecked Sendable {
  static let lock = NSLock()
  nonisolated(unsafe) static var status = 200
  nonisolated(unsafe) static var payload = "{\"minimum_ios_build\":10}"
  nonisolated(unsafe) static var requests = 0
  nonisolated(unsafe) static var buildHeader: String?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let (status, payload) = Self.lock.withLock {
      Self.requests += 1
      Self.buildHeader = request.value(forHTTPHeaderField: "X-Folding-Build")
      return (Self.status, Self.payload)
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil,
        headerFields: ["Content-Type": "application/json", "X-Folding-Minimum-Build": "10"])!,
      cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(payload.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
private actor PolicyProbe {
  var minimum = 0
  func record(_ value: Int) { minimum = value }
}
@MainActor final class AppUpdatePolicyTests: XCTestCase {
  private func session() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [PolicyProtocol.self]
    PolicyProtocol.lock.withLock {
      PolicyProtocol.requests = 0
      PolicyProtocol.status = 200
      PolicyProtocol.payload = "{\"minimum_ios_build\":10}"
    }
    return URLSession(configuration: config)
  }
  func testTransportSendsBuildAndSignalsRequiredUpdateForJSONAndImages() async throws {
    let session = session()
    defer { session.invalidateAndCancel() }
    let probe = PolicyProbe()
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
      deviceID: UUID(), bundleID: "folding.policy.tests.\(UUID())", session: session,
      installedBuild: 8, onUpdateRequired: { await probe.record($0) })
    PolicyProtocol.lock.withLock {
      PolicyProtocol.status = 426
      PolicyProtocol.payload =
        "{\"code\":\"app_update_required\",\"retryable\":false,\"minimum_ios_build\":10}"
    }
    struct Value: Decodable, Sendable { let value: Int }
    do {
      let _: Value = try await transport.send("GET", path: "/v1/me", authenticated: false)
      XCTFail("Expected update requirement")
    } catch let error as CompetitionTransportError { XCTAssertEqual(error.statusCode, 426) }
    let minimum = await probe.minimum
    XCTAssertEqual(minimum, 10)
    XCTAssertEqual(PolicyProtocol.lock.withLock { PolicyProtocol.buildHeader }, "8")
    try await transport.saveSession(
      CompetitionSession(
        access_token: "synthetic", refresh_token: "synthetic", expires_at_ms: Int64.max))
    do {
      _ = try await transport.avatarImage(UUID().uuidString)
      XCTFail("Expected image rejection")
    } catch {}
    XCTAssertEqual(PolicyProtocol.lock.withLock { PolicyProtocol.requests }, 2)
    try await transport.clearSession()
  }
}

private actor UpdateAttestationProbe: CompetitionAttestation {
  nonisolated var isSupported: Bool { true }
  func generateKey() async throws -> String { "synthetic-key" }
  func attestKey(_ key: String, clientDataHash: Data) async throws -> Data { Data() }
  func generateAssertion(_ key: String, clientDataHash: Data) async throws -> Data { Data() }
}
extension AppUpdatePolicyTests {
  func testUpdateRequirementKeepsUploadPendingForTheNewApp() async throws {
    let session = session()
    defer { session.invalidateAndCancel() }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try TrackingStore(directory: directory, installationID: UUID())
    let epoch = UUID()
    try await store.setCompetitionEpoch(epoch)
    _ = try await store.record(
      Observation(
        generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC",
        competitionEpochID: epoch), nowMS: 1000)
    let transport = try CompetitionTransport(
      origin: URL(string: "https://api.getfolding.app")!, deployment: "production",
      deviceID: UUID(), bundleID: "folding.policy.queue.\(UUID())", session: session,
      attestation: UpdateAttestationProbe(), installedBuild: 8, onUpdateRequired: { _ in })
    try await transport.saveSession(
      CompetitionSession(
        access_token: "synthetic", refresh_token: "synthetic", expires_at_ms: Int64.max))
    PolicyProtocol.lock.withLock {
      PolicyProtocol.status = 426
      PolicyProtocol.payload =
        "{\"code\":\"app_update_required\",\"retryable\":false,\"minimum_ios_build\":10}"
    }
    await CompetitionUploader().upload(from: store, transport: transport)
    let pending = try await store.leaseCompetitionUpload(nowMS: TrackingRuntime.nowMS + 10_000_000)
    XCTAssertNotNil(pending)
    XCTAssertEqual(pending?.eventIDs.count, 1)
    XCTAssertEqual(pending?.attempts, 1)
    try await transport.clearSession()
  }
}
