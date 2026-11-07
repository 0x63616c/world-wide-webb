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
