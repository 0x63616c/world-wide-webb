import XCTest
import Foundation
import LocalTranscription
@testable import CallkeepCore

final class VoiceRecognitionTests: XCTestCase {
    @MainActor func testProfileConfirmationPersistsAndCanBeForgotten() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "callkeep-voices-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { try? FileManager.default.removeItem(at: root); defaults.removePersistentDomain(forName: suite) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let id = UUID()
        let data = """
        {"profiles":[],"recordings":{"\(id.uuidString)":{"analysis":{"turns":[{"speakerID":"a","start":0,"end":3}],"embeddings":{"a":[1,0]}},"confirmedNames":{}}}}
        """.data(using: .utf8)!
        try data.write(to: root.appendingPathComponent("VoiceRecognition.json"))
        let voices = VoiceRecognition(root: root, defaults: defaults)
        voices.confirm("a", name: " Maya ", remember: true, in: id)
        XCTAssertEqual(voices.analysis(for: id)?.confirmedNames["a"], "Maya")
        XCTAssertEqual(voices.profiles.first?.name, "Maya")
        let reopened = VoiceRecognition(root: root, defaults: defaults)
        XCTAssertEqual(reopened.suggestedName(for: "a", in: id), "Maya")
        let profileID = try XCTUnwrap(reopened.profiles.first?.id)
        reopened.renameProfile(profileID, name: "Maya S")
        XCTAssertEqual(reopened.profiles.first?.name, "Maya S")
        reopened.removeProfile(profileID)
        XCTAssertTrue(reopened.profiles.isEmpty)
        XCTAssertEqual(reopened.analysis(for: id)?.confirmedNames["a"], "Maya")
        reopened.removeRecording(id)
        XCTAssertNil(reopened.analysis(for: id))
    }
    @MainActor func testCorruptVoiceDataIsNotOverwritten() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("VoiceRecognition.json")
        let original = Data("broken".utf8); try original.write(to: file)
        let voices = VoiceRecognition(root: root)
        voices.clearAll()
        XCTAssertEqual(try Data(contentsOf: file), original)
        XCTAssertNotNil(voices.error)
    }
}
