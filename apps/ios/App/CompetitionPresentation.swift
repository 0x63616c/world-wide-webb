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
struct CompetitionResult: Identifiable, Hashable, Sendable {
  let id: String
  let period: CompetitionPeriod
  let start: Date
  let end: Date
  let version: Int
  let finalizedAt: Date
  let folds: Int
  let rank: Int
  let population: Int
  let medal: CompetitionMedal?
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
struct CompetitionResultsPage: Sendable {
  let items: [CompetitionResult]
  let nextCursor: String?
  let snapshotVersion: String
}
struct CompetitionShare: Sendable {
  let result: CompetitionResult
  let nickname: String
  let approvedAvatarURL: URL?
  let approvedAvatarData: Data?
  init(
    result: CompetitionResult, nickname: String, approvedAvatarURL: URL?,
    approvedAvatarData: Data? = nil
  ) {
    self.result = result
    self.nickname = nickname
    self.approvedAvatarURL = approvedAvatarURL
    self.approvedAvatarData = approvedAvatarData
  }
}
struct HiddenParticipantsPage: Sendable {
  let participantIDs: [String]
  let nextCursor: String?
  let snapshotVersion: String
}

enum CompetitionSheet: String { case join, profile, results, liveShare, milestones }
enum CompetitionRemovalState { case deleting, deleteFailed }

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
    resultsRequestID = UUID()
    requestedResultID = nil
    allTimeResult = nil
    results = []
    resultsCursor = nil
    resultsVersion = nil
    resultsLoading = false
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

  func requestResults(using actions: FoldingActions, nextPage: Bool = false) async {
    if resultsPeriod == .all {
      let request = UUID()
      resultsRequestID = request
      resultsLoading = true
      resultsFailed = false
      defer { if resultsRequestID == request { resultsLoading = false } }
      do {
        let page: LeaderboardPresentation
        if let load = actions.loadLeaderboardPage {
          page = try await load(.all, nil)
        } else if let load = actions.loadLeaderboard {
          page = try await load(.all)
        } else {
          resultsFailed = true
          return
        }
        guard resultsRequestID == request, resultsPeriod == .all, !Task.isCancelled else { return }
        allTimeResult = page
      } catch {
        guard resultsRequestID == request, resultsPeriod == .all else { return }
        resultsFailed = !(error is CancellationError)
      }
      return
    }
    guard let load = actions.loadResults else { return }
    if nextPage && (resultsLoading || resultsCursor == nil) { return }
    let request = UUID()
    resultsRequestID = request
    let period = resultsPeriod
    let cursor = nextPage ? resultsCursor : nil
    resultsLoading = true
    resultsFailed = false
    if !nextPage {
      results = []
      resultsCursor = nil
      resultsVersion = nil
    }
    do {
      let page = try await load(period, cursor)
      guard request == resultsRequestID, !Task.isCancelled else { return }
      if nextPage, let currentVersion = resultsVersion, currentVersion != page.snapshotVersion {
        resultsLoading = false
        await requestResults(using: actions)
        return
      }
      if nextPage {
        let known = Set(results.map(\.id))
        results += page.items.filter { !known.contains($0.id) }
      } else {
        results = page.items
      }
      resultsCursor = page.nextCursor
      resultsVersion = page.snapshotVersion
      resultsLoading = false
    } catch {
      guard request == resultsRequestID else { return }
      resultsLoading = false
      resultsFailed = !(error is CancellationError)
    }
  }
}
