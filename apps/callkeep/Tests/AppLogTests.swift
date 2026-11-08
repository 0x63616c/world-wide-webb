import XCTest
import Foundation

final class AppLogTests: XCTestCase {
    @MainActor func testEventsPersistAndRotateWithoutSensitiveContent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let log = AppLog(directory: root, maxBytes: 1)
        log.record(.appStarted)
        log.record(.titleGuardrail, error: NSError(domain: "FoundationModels.LanguageModelError", code: 2, userInfo: [NSLocalizedDescriptionKey: "PRIVATE TRANSCRIPT"]))
        let text = log.contents()
        XCTAssertTrue(text.contains("app.started"))
        XCTAssertTrue(text.contains("title.blocked_by_model_guardrails"))
        XCTAssertTrue(text.contains("error=foundation_models code=2"))
        XCTAssertFalse(text.contains("PRIVATE TRANSCRIPT"))
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent("callkeep.log").path)[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }
    func testGuardrailErrorHasSpecificMessage() {
        let failure = TitleFailure.classify(NSError(domain: "FoundationModels.LanguageModelError", code: 2))
        XCTAssertEqual(failure.event, .titleGuardrail)
        XCTAssertTrue(failure.message.contains("on-device model"))
        XCTAssertEqual(TitleFailure.classify(NSError(domain: "fixture", code: 1)).event, .titleFailed)
    }
}
