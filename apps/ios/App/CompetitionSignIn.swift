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
  let membership: String
  let restriction: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let nickname_status: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let avatar_status: String
}
// swift-format-ignore: AlwaysUseLowerCamelCase
struct CompetitionSignInResponse: Decodable, Sendable {
  let access_token: String?
  let refresh_token: String?
  let expires_at_ms: Int64
  let profile: CompetitionWireProfile?
  let reauthentication_token: String?
}

@MainActor
final class CompetitionSignIn: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
  private var controller: ASAuthorizationController?
  private var expectedState: String?
  private var anchor: ASPresentationAnchor?

  func signIn(transport: CompetitionTransport, deviceID: UUID) async throws
    -> CompetitionWireProfile
  {
    let response = try await authorize(transport: transport, deviceID: deviceID, purpose: "sign_in")
    guard let access = response.access_token, let refresh = response.refresh_token,
      let profile = response.profile
    else { throw CompetitionTransportError.invalidResponse }
    try await transport.clearSession()
    try await transport.saveSession(
      CompetitionSession(
        access_token: access,
        refresh_token: refresh, expires_at_ms: response.expires_at_ms))
    return profile
  }

  func reauthenticate(transport: CompetitionTransport, deviceID: UUID) async throws -> String {
    let response = try await authorize(
      transport: transport, deviceID: deviceID, purpose: "reauthenticate")
    guard let token = response.reauthentication_token else {
      throw CompetitionTransportError.invalidResponse
    }
    return token
  }

  private func authorize(transport: CompetitionTransport, deviceID: UUID, purpose: String)
    async throws -> CompetitionSignInResponse
  {
    guard continuation == nil, controller == nil else { throw CompetitionTransportError.busy }
    let challenge = try await transport.challenge(purpose: purpose)
    guard challenge.expires_at_ms > TrackingRuntime.nowMS else {
      throw CompetitionTransportError.unauthorized
    }
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = []
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
      // Required explicit null; synthesized optional encoding would omit this field.
      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(operation_id, forKey: .operation_id)
        try container.encode(purpose, forKey: .purpose)
        try container.encode(challenge_id, forKey: .challenge_id)
        try container.encode(identity_token, forKey: .identity_token)
        try container.encode(authorization_code, forKey: .authorization_code)
        try container.encode(device_id, forKey: .device_id)
        try container.encodeNil(forKey: .deletion_operation_id)
      }
      // swift-format-ignore: AlwaysUseLowerCamelCase
      enum Keys: String, CodingKey {
        case operation_id, purpose, challenge_id, identity_token, authorization_code, device_id,
          deletion_operation_id
      }
    }
    let response: CompetitionSignInResponse = try await transport.send(
      "POST", path: "/v1/auth/apple",
      body: CompetitionTransport.encode(
        Exchange(
          operation_id: UUID().uuidString.lowercased(), purpose: purpose,
          challenge_id: challenge.challenge_id, identity_token: identity, authorization_code: code,
          device_id: deviceID.uuidString.lowercased())), authenticated: purpose == "reauthenticate")
    return response
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
