import AuthenticationServices
import FoldingDomain
import Foundation
import Observation
import SwiftUI

import struct FoldingData.PrivateHistoryHealth
import enum FoldingData.SetupAction
import struct FoldingData.SetupProgress
import struct FoldingData.TrackingDiagnosticSnapshot

// Preferences contain presentation choices only. The composition root persists their versioned value.
enum FoldingAppearance: String, Codable, CaseIterable, Identifiable {
  case system, light, dark
  var id: Self { self }
  var scheme: ColorScheme? { self == .system ? nil : (self == .dark ? .dark : .light) }
  var title: String {
    switch self {
    case .system: String(localized: "appearance.system", defaultValue: "System")
    case .light: String(localized: "appearance.light", defaultValue: "Light")
    case .dark: String(localized: "appearance.dark", defaultValue: "Dark")
    }
  }
}

enum FoldingShape {
  static let cornerRadius: CGFloat = 20
}

enum FoldingSurface {
  static let background = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? .black : UIColor(white: 0.89, alpha: 1)
    })
  static let card = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.065, alpha: 1) : .secondarySystemGroupedBackground
    })
}

enum FoldingTint {
  static let color = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark ? .white : .black
    })
  static let onTint = Color(
    uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark ? .black : .white
    })
}

enum SummaryMetric: String, Codable, CaseIterable, Identifiable {
  case folds, timeUnfolded, trend, opens, closes, cycles, lifetimeFolds,
    competitionComparison
  var id: Self { self }
  var title: String {
    switch self {
    case .competitionComparison:
      String(localized: "profile.competition", defaultValue: "Competition")
    case .timeUnfolded: String(localized: "metric.timeUnfolded", defaultValue: "Time unfolded")
    case .trend: String(localized: "metric.trend", defaultValue: "Last 7 days")
    case .opens: String(localized: "metric.opens", defaultValue: "Opens")
    case .closes: String(localized: "metric.closes", defaultValue: "Closes")
    case .cycles: String(localized: "metric.cycles", defaultValue: "Cycles")
    case .lifetimeFolds: String(localized: "metric.lifetimeFolds", defaultValue: "All-time folds")
    case .folds: String(localized: "metric.folds", defaultValue: "Folds")
    }
  }
}

struct FoldingPreferences: Codable, Equatable {
  var schemaVersion = 1
  var appearance: FoldingAppearance = .system
  var metrics: [SummaryMetric] = [.timeUnfolded, .trend]
  var homeTimezone = TimeZone.current.identifier
  var dailyLimit = 100
  var cardOrder: [SummaryMetric]? = nil
  var phoneNames: [String: String] = [:]
  init() {}
  enum CodingKeys: String, CodingKey {
    case schemaVersion, appearance, metrics, homeTimezone, dailyLimit, cardOrder, phoneNames
  }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
    appearance = try values.decode(FoldingAppearance.self, forKey: .appearance)
    // Discard retired/unknown metrics without discarding timezone or other saved choices.
    metrics = try values.decode([String].self, forKey: .metrics)
      .compactMap(SummaryMetric.init(rawValue:)).filter { $0 != .folds }
    homeTimezone = try values.decode(String.self, forKey: .homeTimezone)
    dailyLimit = try values.decode(Int.self, forKey: .dailyLimit)
    phoneNames = try values.decodeIfPresent([String: String].self, forKey: .phoneNames) ?? [:]
    cardOrder = try values.decodeIfPresent([String].self, forKey: .cardOrder)?
      .compactMap(SummaryMetric.init(rawValue:))
  }
  var orderedCards: [SummaryMetric] {
    let enabled = [.folds] + metrics
    var seen = Set<SummaryMetric>()
    return ((cardOrder ?? []) + enabled).filter {
      enabled.contains($0) && seen.insert($0).inserted
    }
  }
  mutating func moveCard(_ card: SummaryMetric, to target: SummaryMetric) {
    var order = orderedCards
    guard card != target, let source = order.firstIndex(of: card),
      let destination = order.firstIndex(of: target)
    else { return }
    order.remove(at: source)
    order.insert(card, at: destination)
    cardOrder = order
  }
}

enum SummaryCardLayout {
  static func usesWideRows(width: CGFloat, accessibilitySize: Bool) -> Bool {
    width >= 600 && !accessibilitySize
  }

  static func rows(_ metrics: [SummaryMetric], width: CGFloat, accessibilitySize: Bool)
    -> [[SummaryMetric]]
  {
    if accessibilitySize { return metrics.map { [$0] } }
    let wide = usesWideRows(width: width, accessibilitySize: accessibilitySize)
    func compact(_ metric: SummaryMetric) -> Bool {
      switch metric {
      case .opens, .closes, .cycles, .lifetimeFolds: true
      default: false
      }
    }
    var rows: [[SummaryMetric]] = []
    for metric in metrics {
      if wide || compact(metric), let last = rows.indices.last, rows[last].count == 1,
        wide || compact(rows[last][0])
      {
        rows[last].append(metric)
      } else {
        rows.append([metric])
      }
    }
    return rows
  }
}

enum HistoryPeriod: String, CaseIterable, Identifiable {
  case day, week, month, all
  var id: Self { self }
  var title: String {
    switch self {
    case .day: String(localized: "history.day", defaultValue: "Day")
    case .week: String(localized: "history.week", defaultValue: "Week")
    case .month: String(localized: "history.month", defaultValue: "Month")
    case .all: String(localized: "history.all", defaultValue: "All")
    }
  }
}

/// Bins are supplied by the analytics layer at the requested grain; views do not rebucket events.
struct HistoryBin: Identifiable, Sendable {
  let start: Date
  let end: Date
  let label: String
  let folds: Int
  var id: Date { start }
}

struct HistoryPresentation: Sendable {
  let title: String
  let folds: Int
  let completeDurationMS: Int64
  let bins: [HistoryBin]
  let sessions: [TrackingSession]
  let canGoNext: Bool
  var canGoPrevious: Bool = false
}

enum CompetitionPeriod: String, CaseIterable, Identifiable, Sendable {
  case week, month, all
  var id: Self { self }
  var title: String {
    switch self {
    case .week: String(localized: "leaderboard.week", defaultValue: "This Week")
    case .month: String(localized: "leaderboard.month", defaultValue: "This Month")
    case .all: String(localized: "leaderboard.all", defaultValue: "All Time")
    }
  }
}

struct LeaderboardEntry: Identifiable, Sendable {
  let id: String
  let rank: Int
  let displayName: String
  let folds: Int
  let approvedAvatarURL: URL?
  let isCurrentUser: Bool
  var approvedAvatarData: Data? = nil
  var featuredBadge: MilestoneBadge? = nil
  var isBlocked = false
}

struct LeaderboardPresentation: Sendable {
  let periodTitle: String
  let entries: [LeaderboardEntry]
  let currentUser: LeaderboardEntry?
  let updatedAt: Date
  var population: Int = 0
  var nextCursor: String? = nil
  var snapshotVersion: String? = nil
  var periodID: String? = nil
}

enum LeaderboardPageError: Error { case snapshotChanged }

enum CompetitionPresentation {
  case unavailable, notJoined
  case loading(LeaderboardPresentation?)
  case loaded(LeaderboardPresentation)
  case failed(LeaderboardPresentation?)
  case banned
  var previous: LeaderboardPresentation? {
    switch self {
    case .loaded(let value): value
    case .loading(let value), .failed(let value): value
    default: nil
    }
  }
}

enum PresentedSheet: Identifiable, Equatable {
  case settings, setup, editSummary, patterns, trackingPhone
  case tiedRank(Int)
  case export(UUID)
  case competition(CompetitionSheet)
  case milestoneUnlock([MilestoneBadge])
  var id: String {
    switch self {
    case .settings: "settings"
    case .competition(let screen): "competition-\(screen.rawValue)"
    case .milestoneUnlock(let badges): "unlock-" + badges.map(\.rawValue).joined(separator: "-")
    case .trackingPhone: "tracking-phone"
    case .setup: "setup"
    case .editSummary: "summary"
    case .patterns: "patterns"
    case .tiedRank(let rank): "tie-\(rank)"
    case .export(let ticket): "export-\(ticket.uuidString)"
    }
  }
}

enum TrackingPhoneSelection: Equatable {
  case notSelected, thisPhone, anotherPhone
  var title: String {
    switch self {
    case .notSelected: String(localized: "phone.notSelected", defaultValue: "Not selected")
    case .thisPhone: String(localized: "phone.thisPhone", defaultValue: "This iPhone")
    case .anotherPhone: String(localized: "phone.anotherPhone", defaultValue: "Another iPhone")
    }
  }
}

enum FoldingTab: Hashable { case today, history, leaderboard, settings }
struct SessionPresentation: Hashable {
  let deviceID: UUID
  let start: Date
  let end: Date?
  let durationMS: Int64?
  let completeness: SessionCompleteness
  let deletionTarget: SessionDeletionTarget
  init(_ session: TrackingSession) {
    deviceID = session.deviceID
    start = Date(timeIntervalSince1970: Double(session.startMS) / 1000)
    end = session.endMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    durationMS = session.durationMS
    completeness = session.completeness
    deletionTarget = SessionDeletionTarget(session)
  }
}

enum HistoryRoute: Hashable { case session(SessionPresentation) }

extension SessionCompleteness {
  var title: String {
    switch self {
    case .complete: String(localized: "session.complete", defaultValue: "Complete")
    case .candidate: String(localized: "session.candidate", defaultValue: "Uncertain")
    case .incomplete: String(localized: "session.incomplete", defaultValue: "Interrupted")
    case .running: String(localized: "session.running", defaultValue: "Running")
    }
  }
}
enum PrivateSyncAvailability: Sendable { case available, localOnly, unavailable, checking }
struct TrackingSyncPresentation: Sendable {
  let iCloud: PrivateSyncAvailability
  let publicTracking: Bool
  let pendingFolds: Int
  let resetPending: Bool
}

enum ExportChoice { case json, csv }

/// All operations are supplied by the app composition. A nil optional command is unavailable,
/// never a simulated success. Commands must return only after durable work has completed.
@MainActor struct FoldingActions {
  var refresh: () async throws -> Void
  var setup: (SetupAction) async throws -> SetupProgress
  var savePreferences: (FoldingPreferences) async throws -> Void
  var loadHistory: ((HistoryPeriod, Int) async throws -> HistoryPresentation)?
  var tipJar: (() -> AnyView)?
  var saveNotifications: ((NotificationPreferences) async throws -> NotificationPreferences)?
  var openNotificationSettings: (() -> Void)?
  var loadSync: ((Bool) async throws -> TrackingSyncPresentation)?
  var useThisPhone: (() async throws -> Void)?
  var loadLeaderboard: ((CompetitionPeriod) async throws -> LeaderboardPresentation)?
  var loadLeaderboardPage: ((CompetitionPeriod, String?) async throws -> LeaderboardPresentation)?
  var openShortcuts: (() -> Void)?
  var reset: (() async throws -> Void)?
  var export: ((ExportChoice) async throws -> UUID)?
  var exportURL: ((UUID) async throws -> URL)?
  var exportFinished: ((UUID) async -> Void)?
  var joinCompetition: ((String) async throws -> Void)?
  var refreshCompetitionProfile: (() async throws -> CompetitionProfile)?
  var loadOwnerMilestones: (() async throws -> MilestoneOwnerLoad)?
  var loadParticipantProfile: ((String) async throws -> ParticipantProfileLoad)?
  var featureMilestone:
    ((String, MilestoneBadge?, ResetGeneration) async throws -> OwnerMilestones)?
  var acknowledgeMilestones: ((String, MilestoneAcknowledgmentRequest) async throws -> Void)?
  var saveNickname: ((String) async throws -> CompetitionProfile)?
  var uploadAvatar: ((Data) async throws -> AvatarState)?
  var removeAvatar: (() async throws -> Void)?
  var loadResults: ((CompetitionPeriod, String?) async throws -> CompetitionResultsPage)?
  var loadResultShare: ((String) async throws -> CompetitionShare)?
  var reportParticipant: ((String, ParticipantReportReason) async throws -> Void)?
  var loadHiddenParticipants: ((String?) async throws -> HiddenParticipantsPage)?
  var setParticipantBlocked: ((String, Bool) async throws -> Void)?
  var deleteCompetitionAccount: (() async throws -> Void)?
  var signInCompetition: (() async throws -> Void)?
  var loadPatterns: (() async throws -> FoldingActivityPatterns)?
  var deleteIncompleteEntry: ((SessionDeletionTarget) async throws -> Void)?
  var appleRequest: ((ASAuthorizationAppleIDRequest) -> Void)?
  var appleCompletion: ((Result<ASAuthorization, Error>) -> Void)?
  /// Verified per-OS/localized instructions, supplied by composition rather than invented by views.
  var openingInstructions: String?
  var closingInstructions: String?
  var loadDiagnostics: (() async throws -> TrackingDiagnosticSnapshot)?
  var clearDiagnostics: (() async throws -> Void)?
  var checkDiagnostics: (() async throws -> Void)?
}

@MainActor @Observable final class FoldingPresentation {
  var entryDeletionPending = false
  /// Widget links select the tab underneath setup; dismissing setup preserves the destination.
  func openWidgetURL(_ url: URL) {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parts.scheme == "folding", parts.user == nil, parts.password == nil,
      parts.port == nil, parts.fragment == nil,
      parts.path.isEmpty || parts.path == "/", parts.query == nil
    else { return }
    switch parts.host {
    case "today": selectedTab = .today
    case "history": selectedTab = .history
    default: return
    }
  }

  func invalidatePersonalPresentation() {
    historyRequest = UUID()
    historyLoading = false
    historyFailed = false
    dismissExports()
    analytics = nil
    history = nil
    setup = nil
    syncStatus = nil
    privateHistoryHealth = nil
    lastEventAt = nil
    localDeviceID = nil
  }

  var selectedTab: FoldingTab = .today
  var analytics: PersonalAnalyticsSnapshot?
  var setup: SetupProgress?
  var preferences = FoldingPreferences()
  var hasLoadedInitialState = false
  var showInitialSetup = false
  var history: HistoryPresentation?
  var historyPeriod: HistoryPeriod = .week
  var historyOffset = 0
  var historyLoading = false
  var historyFailed = false
  var competitionRemoval: CompetitionRemovalState?
  var competitionProfile: CompetitionProfile?
  var ownerMilestones: OwnerMilestones?
  var milestonesContext = UUID()
  var milestonesLoading = false
  var milestonesFailed = false
  var milestonesCached = false
  var milestonesSaving = false
  var milestonesFeatureFailed = false
  var milestonesLastLoaded: Date?
  var milestonesSeen: Set<MilestoneBadge> = []
  var milestonesDisplayed: [MilestoneBadge] = []
  var milestonesForeground = false
  var joinNickname = ""
  var hiddenRequestID = UUID()
  var hiddenLoading = false
  var hiddenFailed = false
  var hiddenCursor: String?
  var hiddenVersion: String?
  var hiddenParticipantIDs: Set<String> = []
  var hiddenParticipantNames: [String: String] = [:]
  var requestedResultID: String?
  var allTimeResult: LeaderboardPresentation?
  var results: [CompetitionResult] = []
  var resultsPeriod: CompetitionPeriod = .week
  var resultsCursor: String?
  var resultsVersion: String?
  var resultsLoading = false
  var resultsFailed = false
  var resultsRequestID = UUID()
  var competition: CompetitionPresentation = .unavailable
  var competitionPeriod: CompetitionPeriod = .week
  var sheet: PresentedSheet?
  var status: String?
  var personalFailure: String?
  var error: String?
  var operation: String?
  var notificationPreferences = NotificationPreferences()
  var notificationAuthorization: NotificationAuthorization = .unknown
  var syncStatus: TrackingSyncPresentation?
  var privateHistoryHealth: PrivateHistoryHealth?
  var canResetHistory: Bool { privateHistoryHealth?.canResetHistory ?? true }

  func requestReset(using actions: FoldingActions) async {
    guard canResetHistory, let reset = actions.reset else { return }
    await command(String(localized: "reset.progress", defaultValue: "Resetting history")) {
      try await reset()
    }
  }

  var competitionAccountExists = false
  var competitionJoined = false
  var publicTrackingPhone: TrackingPhoneSelection?
  var localDeviceID: UUID?
  var lastEventAt: Date?
  var needsSetup: Bool { setup?.step != .complete }
  var trackingPhoneSelection: TrackingPhoneSelection? {
    guard let analytics, let localDeviceID else { return nil }
    guard let selected = analytics.selectedDeviceID else { return .notSelected }
    return selected == localDeviceID ? .thisPhone : .anotherPhone
  }

  func phoneName(for deviceID: UUID?, fallback: String) -> String {
    guard let deviceID,
      let name = preferences.phoneNames[deviceID.uuidString.lowercased()], !name.isEmpty
    else { return fallback }
    return name
  }

  func selectThisPhone(using actions: FoldingActions) async {
    guard let use = actions.useThisPhone, let selection = trackingPhoneSelection,
      selection != .thisPhone || publicTrackingPhone == .anotherPhone
    else { return }
    await command(String(localized: "phone.switching", defaultValue: "Switching phone")) {
      try await use()
    }
  }

  func dismissCompetitionSheets() {
    if case .milestoneUnlock = nextSheet { nextSheet = nil }
    if case .milestoneUnlock = sheet { sheet = nil }
    if case .competition = nextSheet { nextSheet = nil }
    if case .competition = sheet { sheet = nil }
    // Profile/results can also be pushed inside Settings; discard that private navigation stack.
    if sheet == .settings { sheet = nil }
  }

  private var nextSheet: PresentedSheet?
  private var exportRevision = UUID()
  private var historyRequest = UUID()
  private var competitionRequest = UUID()
  private var leaderboardLoadedPeriod: CompetitionPeriod?
  var leaderboardLoadingMore = false
  var leaderboardPageFailed = false

  func present(_ next: PresentedSheet) {
    guard sheet != next else { return }
    if sheet == nil {
      sheet = next
    } else {
      nextSheet = next
      sheet = nil
    }
  }

  func didDismissSheet() {
    if let nextSheet {
      sheet = nextSheet
      self.nextSheet = nil
    }
  }

  /// Invalidates creation already in flight as well as tickets waiting for Settings to dismiss.
  @discardableResult func dismissExports() -> [UUID] {
    exportRevision = UUID()
    var tickets: Set<UUID> = []
    if case .export(let ticket) = sheet {
      tickets.insert(ticket)
      sheet = nil
    }
    if case .export(let ticket) = nextSheet {
      tickets.insert(ticket)
      nextSheet = nil
    }
    return Array(tickets)
  }

  func requestExport(_ choice: ExportChoice, using actions: FoldingActions) async {
    guard let export = actions.export, actions.exportURL != nil else { return }
    let revision = exportRevision
    await command(String(localized: "export.progress", defaultValue: "Preparing export")) {
      let ticket: UUID
      do {
        ticket = try await export(choice)
      } catch {
        guard revision == self.exportRevision, !Task.isCancelled else { return }
        throw error
      }
      guard revision == self.exportRevision, !Task.isCancelled else {
        await actions.exportFinished?(ticket)
        return
      }
      self.present(.export(ticket))
    }
  }

  func command(_ label: String, _ operation: () async throws -> Void) async {
    guard self.operation == nil else { return }
    self.operation = label
    defer { self.operation = nil }
    do { try await operation() } catch is CancellationError {} catch {
      self.error = String(
        localized: "error.tryAgain", defaultValue: "Something went wrong.")
    }
  }

  func requestHistory(using actions: FoldingActions) async {
    guard let load = actions.loadHistory else { return }
    let request = UUID()
    historyRequest = request
    historyLoading = true
    historyFailed = false
    do {
      let value = try await load(historyPeriod, historyOffset)
      guard request == historyRequest, !Task.isCancelled else { return }
      history = value
      historyLoading = false
    } catch {
      guard request == historyRequest else { return }
      historyLoading = false
      historyFailed = !(error is CancellationError)
    }
  }

  func invalidateLeaderboardRequests() {
    competitionRequest = UUID()
    leaderboardLoadingMore = false
    leaderboardPageFailed = false
    leaderboardLoadedPeriod = nil
  }

  func requestLeaderboard(using actions: FoldingActions, nextPage: Bool = false) async {
    guard actions.loadLeaderboard != nil || actions.loadLeaderboardPage != nil else { return }
    let period = competitionPeriod
    let previous = competition.previous
    if nextPage
      && (leaderboardLoadedPeriod != period || leaderboardLoadingMore || previous?.nextCursor == nil
        || actions.loadLeaderboardPage == nil)
    {
      return
    }
    let request = UUID()
    competitionRequest = request
    leaderboardPageFailed = false
    leaderboardLoadingMore = nextPage
    if !nextPage { competition = .loading(previous) }
    do {
      let page: LeaderboardPresentation
      if let load = actions.loadLeaderboardPage {
        page = try await load(period, nextPage ? previous?.nextCursor : nil)
      } else if let load = actions.loadLeaderboard {
        page = try await load(period)
      } else {
        return
      }
      guard request == competitionRequest, period == competitionPeriod, !Task.isCancelled else {
        return
      }
      var value = page
      if nextPage, let previous {
        guard page.snapshotVersion == previous.snapshotVersion, page.periodID == previous.periodID
        else {
          competition = .loading(previous)
          leaderboardLoadedPeriod = nil
          leaderboardLoadingMore = false
          await requestLeaderboard(using: actions)
          return
        }
        let known = Set(previous.entries.map(\.id))
        value = LeaderboardPresentation(
          periodTitle: page.periodTitle,
          entries: previous.entries + page.entries.filter { !known.contains($0.id) },
          currentUser: page.currentUser, updatedAt: page.updatedAt,
          population: page.population,
          nextCursor: page.nextCursor, snapshotVersion: page.snapshotVersion,
          periodID: page.periodID)
      }
      competition = .loaded(value)
      leaderboardLoadedPeriod = period
      leaderboardLoadingMore = false
    } catch {
      guard request == competitionRequest, period == competitionPeriod else { return }
      leaderboardLoadingMore = false
      if nextPage, case LeaderboardPageError.snapshotChanged = error {
        competition = .loading(previous)
        leaderboardLoadedPeriod = nil
        await requestLeaderboard(using: actions)
      } else if nextPage {
        leaderboardPageFailed = !(error is CancellationError)
      } else {
        competition = .failed(previous)
      }
    }
  }

}

func foldingElapsedDuration(_ milliseconds: Int64, locale: Locale = .current) -> String {
  Duration.milliseconds(max(0, milliseconds)).formatted(
    .units(allowed: [.days, .hours, .minutes, .seconds], width: .narrow, maximumUnitCount: 4)
      .locale(locale))
}

func foldingDuration(_ milliseconds: Int64) -> String {
  Duration.milliseconds(max(0, milliseconds)).formatted(
    .units(allowed: [.hours, .minutes, .seconds], width: .abbreviated, maximumUnitCount: 2))
}

/// Clock-only projection of already-reduced running sessions. Never records or replays events.
struct RunningDurationPresentation {
  private let startsMS: [Int64]
  private let asOfMS: Int64
  private let dayEndMS: Int64
  private let completeDurationMS: Int64
  var isRunning: Bool { !startsMS.isEmpty }

  init(snapshot: PersonalAnalyticsSnapshot, day: PersonalDailySummary) {
    asOfMS = snapshot.asOfMS
    dayEndMS = day.endMS
    completeDurationMS = day.completeDurationMS
    startsMS = snapshot.sessions.compactMap { session in
      guard day.timezoneID == snapshot.homeTimezone,
        day.startMS <= snapshot.asOfMS, snapshot.asOfMS < day.endMS,
        session.generation == snapshot.generation,
        session.completeness == .running, session.endMS == nil,
        session.startMS <= snapshot.asOfMS
      else { return nil }
      return max(day.startMS, session.startMS)
    }
  }

  func totalDurationMS(at date: Date) -> Int64 {
    let sum = completeDurationMS.addingReportingOverflow(durationMS(at: date))
    return sum.overflow ? Int64.max : sum.partialValue
  }

  func durationMS(at date: Date) -> Int64 {
    let rawMS = date.timeIntervalSince1970 * 1000
    // A backwards/invalid wall clock cannot subtract confirmed elapsed time. Future-dated
    // session anchors stay excluded until a new authoritative snapshot makes them eligible.
    let boundedMS =
      rawMS.isFinite
      ? min(Double(dayEndMS), max(Double(asOfMS), rawMS)) : Double(asOfMS)
    let endMS = Int64(boundedMS)
    return startsMS.reduce(Int64(0)) { total, start in
      let elapsed = max(0, endMS - start)
      let sum = total.addingReportingOverflow(elapsed)
      return sum.overflow ? Int64.max : sum.partialValue
    }
  }
}
