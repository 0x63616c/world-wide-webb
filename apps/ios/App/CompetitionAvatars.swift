import CryptoKit
import Foundation

struct CompetitionAvatarUpload: Codable, Sendable {
  let participantID: String
  let operationID: String
  let digest: String
  var avatarID: String?
}

extension CompetitionAPI {
  func uploadAvatar(_ bytes: Data) async throws -> AvatarReviewState {
    guard !bytes.isEmpty, bytes.count <= 2 * 1024 * 1024 else {
      throw CompetitionTransportError.invalidResponse
    }
    let contentType: String
    if bytes.starts(with: [0xff, 0xd8, 0xff]) {
      contentType = "image/jpeg"
    } else if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
      contentType = "image/png"
    } else {
      throw CompetitionTransportError.invalidResponse
    }
    let context = await transport.avatarContext()
    let owner = try await me().profile.participant_id
    let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    let saved = try await transport.avatarUpload()
    var upload: CompetitionAvatarUpload
    if let saved, saved.participantID == owner, saved.digest == digest {
      upload = saved
    } else {
      upload = CompetitionAvatarUpload(
        participantID: owner, operationID: UUID().uuidString.lowercased(), digest: digest)
      try await transport.saveAvatarUpload(upload, context: context)
    }
    struct Response: Decodable, Sendable {
      let avatarID: String
      let state: AvatarReviewState
      enum CodingKeys: String, CodingKey {
        case avatarID = "avatar_id"
        case state
      }
    }
    let result: Response = try await transport.protected(
      "PUT", path: "/v1/avatars/\(upload.operationID)", purpose: "avatar_upload", body: bytes,
      contentType: contentType)
    guard UUID(uuidString: result.avatarID) != nil, result.state == .pending else {
      throw CompetitionTransportError.invalidResponse
    }
    upload.avatarID = result.avatarID
    try await transport.saveAvatarUpload(upload, context: context)
    return result.state
  }

  func avatarStatus(_ id: String) async throws -> AvatarReviewState {
    guard UUID(uuidString: id) != nil else { throw CompetitionTransportError.invalidResponse }
    struct Response: Decodable, Sendable { let state: AvatarReviewState }
    let response: Response = try await transport.send("GET", path: "/v1/avatars/\(id)/status")
    guard response.state != .none else { throw CompetitionTransportError.invalidResponse }
    return response.state
  }

  func removeProfileAvatars() async throws -> CompetitionWireProfile {
    let context = await transport.avatarContext()
    let profile = try await me().profile
    let saved = try await transport.avatarUpload()
    var ids = Set([profile.avatar_id, profile.pending_avatar_id].compactMap { $0 })
    if let saved, saved.participantID == profile.participant_id, let id = saved.avatarID {
      ids.insert(id)
    }
    for id in ids.sorted() {
      guard UUID(uuidString: id) != nil else { throw CompetitionTransportError.invalidResponse }
      let operation = try await transport.avatarRemovalOperation(id: id, context: context)
      let response: CompetitionOperation = try await transport.send(
        "DELETE", path: "/v1/avatars/\(id)?operation_id=\(operation)")
      guard response.operation_id == operation, response.state == "completed" else {
        throw CompetitionTransportError.invalidResponse
      }
      try await transport.finishAvatarRemoval(id: id, context: context)
    }
    try await transport.saveAvatarUpload(nil, context: context)
    return try await me().profile
  }

  func refreshedProfile() async throws -> CompetitionWireProfile {
    var profile = try await me().profile
    if let pending = profile.pending_avatar_id {
      let status = try await avatarStatus(pending)
      if status != .pending {
        profile = try await me().profile
      } else {
        profile.avatar_status = status.rawValue
      }
    }
    return profile
  }
}
