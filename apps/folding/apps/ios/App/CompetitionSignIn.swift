import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

struct CompetitionWireProfile: Codable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let participant_id: String
  let nickname: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let avatar_id: String?
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let membership: String
  let restriction: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let nickname_status: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  var avatar_status: String
}
// swift-format-ignore: AlwaysUseLowerCamelCase
struct CompetitionSignInResponse: Decodable, Sendable {
  let access_token: String?
  let refresh_token: String?
  let expires_at_ms: Int64?
  let status: CompetitionOperation?
  let polling_token: String?
  let polling_token_expires_at_ms: Int64?
  let profile: CompetitionWireProfile?
  let reauthentication_token: String?
}

struct CompetitionSignInResult {
  let profile: CompetitionWireProfile
  let suggestedName: String?
}

/// Apple supplies a name only on the initial grant. Retain it before the server exchange
/// so an exchange failure or a later authorization cannot discard that one-time response.
enum AppleNameSuggestion {
  static let store = CompetitionCredentialStore(
    service: (Bundle.main.bundleIdentifier ?? "Folding") + ".apple-name-suggestion")
  private struct Saved: Codable {
    let userHash: String
    let name: String
    var participantID: String?
  }
  static func bindParticipant(_ participantID: String) throws {
    guard let data = try store.read("apple-name"),
      var saved = try? JSONDecoder().decode(Saved.self, from: data)
    else { return }
    saved.participantID = participantID
    try store.write(JSONEncoder().encode(saved), account: "apple-name")
  }
  static func name(forParticipant participantID: String) -> String? {
    guard let data = try? store.read("apple-name"),
      let saved = try? JSONDecoder().decode(Saved.self, from: data),
      saved.participantID == participantID
    else { return nil }
    return saved.name
  }
  static func resolve(
    _ components: PersonNameComponents?, userID: String,
    store: CompetitionCredentialStore
  ) throws -> String? {
    let userHash = SHA256.hash(data: Data(userID.utf8)).map { String(format: "%02x", $0) }.joined()
    if let components {
      let full = PersonNameComponentsFormatter().string(from: components)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if !full.isEmpty {
        let given = components.givenName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let name = full.count <= 20 || given.isEmpty ? full : given
        try store.write(
          JSONEncoder().encode(Saved(userHash: userHash, name: name, participantID: nil)),
          account: "apple-name")
        return name
      }
    }
    if let data = try store.read("apple-name"),
      let saved = try? JSONDecoder().decode(Saved.self, from: data), saved.userHash == userHash
    {
      return saved.name
    }
    try store.remove("apple-name")
    return nil
  }
}

@MainActor
final class CompetitionSignIn: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
  private var controller: ASAuthorizationController?
  private var expectedState: String?
  private var anchor: ASPresentationAnchor?

  func signIn(
    transport: CompetitionTransport, deviceID: UUID, existingParticipantID: String? = nil,
    existingAccountOnly: Bool = false
  )
    async throws
    -> CompetitionSignInResult
  {
    let context = await transport.sessionContext()
    let (response, name) = try await authorize(
      transport: transport, deviceID: deviceID, purpose: "sign_in",
      existingParticipantID: existingParticipantID, existingAccountOnly: existingAccountOnly)
    guard let access = response.access_token, let refresh = response.refresh_token,
      let profile = response.profile, let expiry = response.expires_at_ms
    else { throw CompetitionTransportError.invalidResponse }
    try await transport.replaceSession(
      CompetitionSession(
        access_token: access,
        refresh_token: refresh, expires_at_ms: expiry), context: context)
    try AppleNameSuggestion.bindParticipant(profile.participant_id)
    return CompetitionSignInResult(profile: profile, suggestedName: name)
  }

  func reauthenticate(transport: CompetitionTransport, deviceID: UUID) async throws -> String {
    let (response, _) = try await authorize(
      transport: transport, deviceID: deviceID, purpose: "reauthenticate")
    guard let token = response.reauthentication_token else {
      throw CompetitionTransportError.invalidResponse
    }
    return token
  }

  func recoverDeletion(transport: CompetitionTransport, deviceID: UUID, operationID: String)
    async throws -> CompetitionDeletionReceipt
  {
    let (response, _) = try await authorize(
      transport: transport, deviceID: deviceID,
      purpose: "recover_deletion", deletionOperationID: operationID)
    guard let status = response.status, let token = response.polling_token,
      let expiry = response.polling_token_expires_at_ms
    else { throw CompetitionTransportError.invalidResponse }
    return CompetitionDeletionReceipt(
      status: status, polling_token: token, polling_token_expires_at_ms: expiry)
  }

  private func authorize(
    transport: CompetitionTransport, deviceID: UUID, purpose: String,
    deletionOperationID: String? = nil, existingParticipantID: String? = nil,
    existingAccountOnly: Bool = false
  )
    async throws -> (CompetitionSignInResponse, String?)
  {
    guard continuation == nil, controller == nil else { throw CompetitionTransportError.busy }
    let challenge = try await transport.challenge(purpose: purpose)
    guard challenge.expires_at_ms > TrackingRuntime.nowMS else {
      throw CompetitionTransportError.unauthorized
    }
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = purpose == "sign_in" ? [.fullName] : []
    request.nonce = SHA256.hash(data: Data(challenge.nonce.utf8)).map { String(format: "%02x", $0) }
      .joined()
    request.state = UUID().uuidString.lowercased()
    expectedState = request.state
    guard
      let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive })?.windows.first(
          where: \.isKeyWindow)
    else { throw CompetitionTransportError.unavailable }
    anchor = window
    let authorization = ASAuthorizationController(authorizationRequests: [request])
    authorization.delegate = self
    authorization.presentationContextProvider = self
    controller = authorization
    defer {
      controller = nil
      anchor = nil
      expectedState = nil
      continuation = nil
    }
    let credential: ASAuthorizationAppleIDCredential = try await withCheckedThrowingContinuation {
      continuation in
      self.continuation = continuation
      authorization.performRequests()
    }
    guard credential.state == expectedState,
      let identityData = credential.identityToken, let codeData = credential.authorizationCode,
      let identity = String(data: identityData, encoding: .utf8),
      let code = String(data: codeData, encoding: .utf8)
    else { throw CompetitionTransportError.unauthorized }
    let suggestedName =
      purpose == "sign_in"
      ? try AppleNameSuggestion.resolve(
        credential.fullName, userID: credential.user,
        store: AppleNameSuggestion.store) : nil
    struct Exchange: Encodable {
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let operation_id: String
      let purpose: String
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let challenge_id: String
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let identity_token: String
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let authorization_code: String
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let device_id: String
      let deletionOperationID: String?
      let existingParticipantID: String?
      let existingAccountOnly: Bool
      // Required explicit null; synthesized optional encoding would omit this field.
      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(operation_id, forKey: .operation_id)
        try container.encode(purpose, forKey: .purpose)
        try container.encode(challenge_id, forKey: .challenge_id)
        try container.encode(identity_token, forKey: .identity_token)
        try container.encode(authorization_code, forKey: .authorization_code)
        try container.encode(device_id, forKey: .device_id)
        try container.encodeIfPresent(existingParticipantID, forKey: .existing_participant_id)
        if existingAccountOnly { try container.encode(true, forKey: .existing_account_only) }
        if let deletionOperationID {
          try container.encode(deletionOperationID, forKey: .deletion_operation_id)
        } else {
          try container.encodeNil(forKey: .deletion_operation_id)
        }
      }
      // swift-format-ignore: AlwaysUseLowerCamelCase
      enum Keys: String, CodingKey {
        case operation_id, purpose, challenge_id, identity_token, authorization_code, device_id,
          deletion_operation_id, existing_participant_id, existing_account_only
      }
    }
    let response: CompetitionSignInResponse = try await transport.send(
      "POST", path: "/v1/auth/apple",
      body: CompetitionTransport.encode(
        Exchange(
          operation_id: UUID().uuidString.lowercased(), purpose: purpose,
          challenge_id: challenge.challenge_id, identity_token: identity, authorization_code: code,
          device_id: deviceID.uuidString.lowercased(), deletionOperationID: deletionOperationID,
          existingParticipantID: existingParticipantID, existingAccountOnly: existingAccountOnly)),
      authenticated: purpose == "reauthenticate")
    return (response, suggestedName)
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    anchor!
  }
  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
      continuation?.resume(throwing: CompetitionTransportError.unauthorized)
      continuation = nil
      return
    }
    continuation?.resume(returning: credential)
    continuation = nil
  }
  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) {
    continuation?.resume(throwing: error)
    continuation = nil
  }
}
