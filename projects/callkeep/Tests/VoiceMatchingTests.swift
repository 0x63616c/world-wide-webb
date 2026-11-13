import XCTest

@testable import CallkeepCore

final class VoiceMatchingTests: XCTestCase {
  func testSimilarityRejectsInvalidVectors() {
    XCTAssertNil(VoiceMatching.similarity([], []))
    XCTAssertNil(VoiceMatching.similarity([0, 0], [1, 1]))
    XCTAssertNil(VoiceMatching.similarity([.nan], [1]))
    XCTAssertNil(VoiceMatching.similarity([1], [1, 2]))
    XCTAssertEqual(VoiceMatching.similarity([2, 0], [3, 0])!, 1, accuracy: 0.00001)
  }
  func testMatchRequiresStrongUnambiguousCandidate() {
    let first = UUID()
    let second = UUID()
    XCTAssertEqual(
      VoiceMatching.candidate(for: [1, 0], profiles: [(first, [1, 0]), (second, [0, 1])]), first)
    XCTAssertNil(
      VoiceMatching.candidate(for: [1, 0], profiles: [(first, [1, 0]), (second, [1, 0.01])]))
    XCTAssertNil(VoiceMatching.candidate(for: [1, 0], profiles: [(first, [0, 1])]))
  }
}
