import Foundation
import XCTest

@testable import FoldingPresentation

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
  func testKnownRequirementSurvivesOfflineRestartAndNewBuildOrRollbackRecovers() async {
    let name = "folding.update.tests.\(UUID())"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let session = session()
    defer { session.invalidateAndCancel() }
    func model(_ build: Int = 8) -> AppUpdatePolicy {
      AppUpdatePolicy(
        environment: "production", origin: URL(string: "https://api.getfolding.app")!,
        installedBuild: build, defaults: defaults, session: session)
    }
    let current = model()
    XCTAssertFalse(current.requiresUpdate)
    await current.refresh()
    XCTAssertTrue(current.requiresUpdate)
    XCTAssertEqual(PolicyProtocol.lock.withLock { PolicyProtocol.buildHeader }, "8")
    await current.refresh()
    XCTAssertEqual(PolicyProtocol.lock.withLock { PolicyProtocol.requests }, 1)
    let restarted = model()
    XCTAssertTrue(restarted.requiresUpdate)
    PolicyProtocol.lock.withLock { PolicyProtocol.status = 503 }
    await restarted.refresh()
    XCTAssertTrue(restarted.requiresUpdate)
    XCTAssertTrue(restarted.checkFailed)
    XCTAssertFalse(model(10).requiresUpdate)
    PolicyProtocol.lock.withLock {
      PolicyProtocol.status = 200
      PolicyProtocol.payload = "{\"minimum_ios_build\":0}"
    }
    await restarted.refresh(force: true)
    XCTAssertFalse(restarted.requiresUpdate)
    XCTAssertFalse(model().requiresUpdate)
  }
  func testUnknownPolicyFailsOpenAndInvalidPolicyCannotClearKnownRequirement() async {
    let name = "folding.update.tests.\(UUID())"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let session = session()
    defer { session.invalidateAndCancel() }
    let model = AppUpdatePolicy(
      environment: "production", origin: URL(string: "https://api.getfolding.app")!,
      installedBuild: 8, defaults: defaults, session: session)
    PolicyProtocol.lock.withLock { PolicyProtocol.status = 503 }
    await model.refresh()
    XCTAssertFalse(model.requiresUpdate)
    model.require(minimumBuild: 10, environment: "retired")
    XCTAssertFalse(model.requiresUpdate)
    model.require(minimumBuild: 10, environment: "production")
    XCTAssertTrue(model.requiresUpdate)
    PolicyProtocol.lock.withLock {
      PolicyProtocol.status = 200
      PolicyProtocol.payload = "{\"minimum_ios_build\":-1}"
    }
    await model.refresh(force: true)
    XCTAssertTrue(model.requiresUpdate)
    XCTAssertTrue(model.checkFailed)
  }
}
