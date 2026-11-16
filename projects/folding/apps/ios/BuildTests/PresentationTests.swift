import FoldingDomain
import Foundation
import XCTest

@testable import Folding

@MainActor final class PresentationTests: XCTestCase {
  func testBlockedContractDecodesOldAndNewResponsesWithoutChangingRanks() throws {
    let old = Data(
      #"{"participant_id":"id","nickname":"Name","avatar_id":null,"folds":42,"rank":2,"medal":"silver"}"#
        .utf8)
    let legacy = try JSONDecoder().decode(CompetitionWireRank.self, from: old)
    XCTAssertNil(legacy.blocked)
    let new = Data(
      #"{"participant_id":"id","nickname":"Blocked player","avatar_id":null,"folds":42,"rank":2,"medal":"silver","blocked":true,"featured_badge_id":null}"#
        .utf8)
    let masked = try JSONDecoder().decode(CompetitionWireRank.self, from: new)
    XCTAssertEqual(masked.rank, legacy.rank)
    XCTAssertEqual(masked.folds, legacy.folds)
    XCTAssertEqual(masked.blocked, true)
    // Exact shipped DTO shape: new responses retain all required legacy fields.
    // swift-format-ignore: AlwaysUseLowerCamelCase
    struct ShippedRank: Decodable {
      let participant_id: String
      let nickname: String
      let avatar_id: String?
      let folds: Int
      let rank: Int
      let medal: String?
    }
    XCTAssertEqual(try JSONDecoder().decode(ShippedRank.self, from: new).nickname, "Blocked player")
  }

  func testAppleNameSurvivesRepeatAuthorizationAndDoesNotCrossAccounts() throws {
    let store = CompetitionCredentialStore(service: "folding.name.test.\(UUID())")
    defer { try? store.remove("apple-name") }
    var name = PersonNameComponents()
    name.givenName = "Ari"
    name.familyName = "Webb"
    XCTAssertEqual(try AppleNameSuggestion.resolve(name, userID: "first", store: store), "Ari Webb")
    XCTAssertEqual(try AppleNameSuggestion.resolve(nil, userID: "first", store: store), "Ari Webb")
    XCTAssertNil(try AppleNameSuggestion.resolve(nil, userID: "second", store: store))
    XCTAssertNil(try AppleNameSuggestion.resolve(nil, userID: "first", store: store))
  }

  func testBadgePushRouteRequiresKnownAwardsAndOwnerIdentity() {
    let owner = UUID().uuidString.lowercased()
    let payload: [AnyHashable: Any] = [
      "folding": [
        "kind": "badges_earned", "participant_id": owner, "badge_ids": ["folds_1", "days_7"],
      ]
    ]
    let route = PushNotificationRoute.parse(payload)
    XCTAssertEqual(route?.participantID, owner)
    XCTAssertEqual(route?.isBadge, true)
    for ids in [[], ["unknown"], ["folds_1", "folds_1"]] {
      XCTAssertNil(
        PushNotificationRoute.parse([
          "folding": ["kind": "badges_earned", "participant_id": owner, "badge_ids": ids]
        ]))
    }
    XCTAssertNil(
      PushNotificationRoute.parse([
        "folding": ["kind": "badges_earned", "participant_id": "other", "badge_ids": ["folds_1"]]
      ]))
  }

  func testNotificationLocalesFallbackWithoutBlockingPreferences() {
    XCTAssertEqual(PushRegistration.supportedLocale("it-IT"), "en")
    XCTAssertEqual(PushRegistration.supportedLocale("ja-JP"), "ja")
    XCTAssertEqual(PushRegistration.supportedLocale("pt-BR"), "pt-BR")
  }
}
