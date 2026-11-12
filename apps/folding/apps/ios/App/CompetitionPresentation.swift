import Foundation

struct CompetitionProfile: Equatable, Sendable {
  let id: String
  let nickname: String
  let approvedAvatarURL: URL?
  let avatarState: AvatarState
  var approvedAvatarData: Data? = nil
}
enum AvatarState: String, Codable, Sendable { case none, approved, rejected }
enum CompetitionUIError: Error { case chooseAnotherName }
enum ParticipantReportReason: String, CaseIterable, Identifiable, Sendable {
  case abusiveName = "abusive_name"
  case abusiveAvatar = "abusive_avatar"
  case suspectedCheating = "suspected_cheating"
  case other
  var id: Self { self }
  var title: String {
    switch self {
    case .abusiveName: String(localized: "report.name", defaultValue: "Inappropriate name")
    case .abusiveAvatar: String(localized: "report.avatar", defaultValue: "Inappropriate photo")
    case .suspectedCheating:
      String(localized: "report.cheating", defaultValue: "Suspected cheating")
    case .other: String(localized: "report.other", defaultValue: "Other")
    }
  }
}
enum CompetitionMedal: String, Sendable {
  case gold, silver, bronze
  var title: String {
    switch self {
    case .gold: String(localized: "medal.gold", defaultValue: "Gold")
    case .silver: String(localized: "medal.silver", defaultValue: "Silver")
    case .bronze: String(localized: "medal.bronze", defaultValue: "Bronze")
    }
  }
}
struct HiddenParticipantsPage: Sendable {
  let participantIDs: [String]
  let nextCursor: String?
  let snapshotVersion: String
}

enum CompetitionSheet: String { case join, profile, milestones }
enum CompetitionRemovalState { case deleting, deleteFailed, cleanupAttention, statusUnavailable }

extension FoldingPresentation {
  func beginJoin(suggestedNickname: String) {
    joinNickname = suggestedNickname
    present(.competition(.join))
  }

  /// Invalidate all private result/profile presentation on reset, leave or account change.
  func invalidateCompetitionPresentation() {
    invalidateMilestones()
    invalidateLeaderboardRequests()
    hiddenRequestID = UUID()
    hiddenLoading = false
    hiddenCursor = nil
    hiddenVersion = nil
    hiddenFailed = false
    competitionProfile = nil
    joinNickname = ""
    hiddenParticipantIDs = []
    hiddenParticipantNames = [:]
    dismissCompetitionSheets()
  }

  func requestHiddenParticipants(using actions: FoldingActions, nextPage: Bool = false) async {
    guard let load = actions.loadHiddenParticipants else { return }
    if nextPage && (hiddenLoading || hiddenCursor == nil) { return }
    let request = UUID()
    hiddenRequestID = request
    hiddenLoading = true
    hiddenFailed = false
    do {
      let page = try await load(nextPage ? hiddenCursor : nil)
      guard request == hiddenRequestID, !Task.isCancelled else { return }
      if nextPage && hiddenVersion != page.snapshotVersion {
        hiddenLoading = false
        await requestHiddenParticipants(using: actions)
        return
      }
      if nextPage {
        hiddenParticipantIDs.formUnion(page.participantIDs)
      } else {
        hiddenParticipantIDs = Set(page.participantIDs)
      }
      hiddenVersion = page.snapshotVersion
      hiddenCursor = page.nextCursor
      hiddenLoading = false
    } catch {
      guard request == hiddenRequestID else { return }
      hiddenLoading = false
      if nextPage, case LeaderboardPageError.snapshotChanged = error {
        await requestHiddenParticipants(using: actions)
      } else {
        hiddenFailed = !(error is CancellationError)
      }
    }
  }

}

func blockedPlayerName(_ id: String) -> String {
  String(localized: "block.player", defaultValue: "Blocked player") + " · "
    + id.prefix(8).uppercased()
}

extension FoldingPresentation {
  /// Retire in-flight requests before removing identity from every retained board.
  func updateBlockedParticipant(_ id: String, blocked: Bool) {
    invalidateLeaderboardRequests()
    invalidateMilestones()
    hiddenRequestID = UUID()
    hiddenLoading = false
    if blocked { hiddenParticipantIDs.insert(id) } else { hiddenParticipantIDs.remove(id) }
    func project(_ board: LeaderboardPresentation) -> LeaderboardPresentation {
      var board = board
      board = LeaderboardPresentation(
        periodTitle: board.periodTitle,
        entries: board.entries.map { entry in
          guard entry.id == id, blocked else { return entry }
          return LeaderboardEntry(
            id: entry.id, rank: entry.rank, displayName: blockedPlayerName(id),
            folds: entry.folds, approvedAvatarURL: nil, isCurrentUser: false, isBlocked: true)
        }, currentUser: board.currentUser, updatedAt: board.updatedAt, population: board.population,
        nextCursor: nil, snapshotVersion: nil, periodID: board.periodID)
      return board
    }
    if let board = competition.previous { competition = .loaded(project(board)) }
    if blocked, case .tiedRank = sheet { sheet = nil }
  }
}
