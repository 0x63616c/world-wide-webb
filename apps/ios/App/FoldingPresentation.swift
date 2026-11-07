import AuthenticationServices
import FoldingDomain
import Foundation
import Observation
import SwiftUI

import struct FoldingData.PrivateHistoryHealth
import enum FoldingData.SetupAction
import struct FoldingData.SetupProgress

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

enum FoldingAccent: String, Codable, CaseIterable, Identifiable {
  case blue, teal, green, orange, pink, purple
  var id: Self { self }
  var color: Color {
    switch self {
    case .blue: .blue
    case .teal: .teal
    case .green: .green
    case .orange: .orange
    case .pink: .pink
    case .purple: .purple
    }
  }
  var title: String {
    switch self {
    case .blue: String(localized: "accent.blue", defaultValue: "Blue")
    case .teal: String(localized: "accent.teal", defaultValue: "Teal")
    case .green: String(localized: "accent.green", defaultValue: "Green")
    case .orange: String(localized: "accent.orange", defaultValue: "Orange")
    case .pink: String(localized: "accent.pink", defaultValue: "Pink")
    case .purple: String(localized: "accent.purple", defaultValue: "Purple")
    }
  }
}

enum SummaryMetric: String, Codable, CaseIterable, Identifiable {
  case timeUnfolded, trend, opens, closes, cycles, lifetimeFolds, equivalentTravel
  var id: Self { self }
  var title: String {
    switch self {
    case .timeUnfolded: String(localized: "metric.timeUnfolded", defaultValue: "Time unfolded")
    case .trend: String(localized: "metric.trend", defaultValue: "Last 7 days")
    case .opens: String(localized: "metric.opens", defaultValue: "Opens")
    case .closes: String(localized: "metric.closes", defaultValue: "Closes")
    case .cycles: String(localized: "metric.cycles", defaultValue: "Cycles")
    case .lifetimeFolds: String(localized: "metric.lifetimeFolds", defaultValue: "All-time folds")
    case .equivalentTravel:
      String(localized: "metric.equivalentTravel", defaultValue: "Equivalent travel")
    }
  }
}

struct FoldingPreferences: Codable, Equatable {
  var schemaVersion = 1
  var appearance: FoldingAppearance = .system
  var accent: FoldingAccent = .blue
  var metrics: [SummaryMetric] = [.timeUnfolded, .trend]
  var homeTimezone = TimeZone.current.identifier
  var dailyLimit = 100
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
}

enum CompetitionPeriod: String, CaseIterable, Identifiable, Sendable {
  case week, month, all
  var id: Self { self }
  var title: String {
    switch self {
    case .week: String(localized: "leaderboard.week", defaultValue: "Week")
    case .month: String(localized: "leaderboard.month", defaultValue: "Month")
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
  var percentile: Int? = nil
}

struct LeaderboardPresentation: Sendable {
  let periodTitle: String
  let entries: [LeaderboardEntry]
  let currentUser: LeaderboardEntry?
  let pendingFolds: Int
  let updatedAt: Date
  var population: Int = 0
  var percentile: Int? = nil
}

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
  case settings, setup, editSummary, travelInfo, leaderboardInfo, trackingPhone
  case tiedRank(Int)
  case export(UUID)
  case competition(CompetitionSheet)
  var id: String {
    switch self {
    case .settings: "settings"
    case .competition(let screen): "competition-\(screen.rawValue)"
    case .trackingPhone: "tracking-phone"
    case .setup: "setup"
    case .editSummary: "summary"
    case .travelInfo: "travel"
    case .leaderboardInfo: "leaderboard-info"
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

enum FoldingTab: Hashable { case today, history, leaderboard }
struct SessionPresentation: Hashable {
  let deviceID: UUID
  let start: Date
  let end: Date?
  let durationMS: Int64?
  let completeness: SessionCompleteness
  init(_ session: TrackingSession) {
    deviceID = session.deviceID
    start = Date(timeIntervalSince1970: Double(session.startMS) / 1000)
    end = session.endMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    durationMS = session.durationMS
    completeness = session.completeness
  }
}

enum HistoryRoute: Hashable { case session(SessionPresentation) }

extension SessionCompleteness {
  var title: String {
    switch self {
    case .complete: String(localized: "session.complete", defaultValue: "Complete")
    case .candidate: String(localized: "session.candidate", defaultValue: "Uncertain")
    case .incomplete: String(localized: "session.incomplete", defaultValue: "Incomplete")
    case .running: String(localized: "session.running", defaultValue: "Running")
    }
  }
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
  var useThisPhone: (() async throws -> Void)?
  var loadLeaderboard: ((CompetitionPeriod) async throws -> LeaderboardPresentation)?
  var openShortcuts: (() -> Void)?
  var reset: (() async throws -> Void)?
  var export: ((ExportChoice) async throws -> UUID)?
  var exportURL: ((UUID) async throws -> URL)?
  var exportFinished: ((UUID) async -> Void)?
  var joinCompetition: ((String) async throws -> Void)?
  var saveNickname: ((String) async throws -> CompetitionProfile)?
  var uploadAvatar: ((Data) async throws -> AvatarReviewState)?
  var removeAvatar: (() async throws -> Void)?
  var loadResults: ((CompetitionPeriod, String?) async throws -> CompetitionResultsPage)?
  var loadResultShare: ((String) async throws -> CompetitionShare)?
  var reportParticipant: ((String, ParticipantReportReason) async throws -> Void)?
  var setParticipantBlocked: ((String, Bool) async throws -> Void)?
  var leaveCompetition: (() async throws -> Void)?
  var deleteCompetitionAccount: (() async throws -> Void)?
  var signInCompetition: (() async throws -> Void)?
  var appleRequest: ((ASAuthorizationAppleIDRequest) -> Void)?
  var appleCompletion: ((Result<ASAuthorization, Error>) -> Void)?
  /// Verified per-OS/localized instructions, supplied by composition rather than invented by views.
  var openingInstructions: String?
  var closingInstructions: String?
}

@MainActor @Observable final class FoldingPresentation {
  var selectedTab: FoldingTab = .today
  var analytics: PersonalAnalyticsSnapshot?
  var setup: SetupProgress?
  var preferences = FoldingPreferences()
  var history: HistoryPresentation?
  var historyPeriod: HistoryPeriod = .week
  var historyOffset = 0
  var historyLoading = false
  var historyFailed = false
  var competitionRemoval: CompetitionRemovalState?
  var competitionProfile: CompetitionProfile?
  var joinNickname = ""
  var hiddenParticipantIDs: Set<String> = []
  var hiddenParticipantNames: [String: String] = [:]
  var requestedResultID: String?
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
  var privateHistoryHealth: PrivateHistoryHealth?
  var canResetHistory: Bool { privateHistoryHealth?.canResetHistory ?? true }

  func requestReset(using actions: FoldingActions) async {
    guard canResetHistory, let reset = actions.reset else { return }
    await command(String(localized: "reset.progress", defaultValue: "Resetting history")) {
      try await reset()
    }
  }

  var localDeviceID: UUID?
  var lastEventAt: Date?
  var needsSetup: Bool { setup?.step != .complete }
  var trackingPhoneSelection: TrackingPhoneSelection? {
    guard let analytics, let localDeviceID else { return nil }
    guard let selected = analytics.selectedDeviceID else { return .notSelected }
    return selected == localDeviceID ? .thisPhone : .anotherPhone
  }

  func selectThisPhone(using actions: FoldingActions) async {
    guard let use = actions.useThisPhone, let selection = trackingPhoneSelection,
      selection != .thisPhone
    else { return }
    await command(String(localized: "phone.switching", defaultValue: "Switching phone")) {
      try await use()
    }
  }

  func dismissCompetitionSheets() {
    if case .competition = nextSheet { nextSheet = nil }
    if case .competition = sheet { sheet = nil }
    // Profile/results can also be pushed inside Settings; discard that private navigation stack.
    if sheet == .settings { sheet = nil }
  }

  private var nextSheet: PresentedSheet?
  private var exportRevision = UUID()
  private var historyRequest = UUID()
  private var competitionRequest = UUID()

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
        localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
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

  func requestLeaderboard(using actions: FoldingActions) async {
    guard let load = actions.loadLeaderboard else { return }
    let request = UUID()
    competitionRequest = request
    let previous = competition.previous
    competition = .loading(previous)
    do {
      let value = try await load(competitionPeriod)
      guard request == competitionRequest, !Task.isCancelled else { return }
      competition = .loaded(value)
    } catch {
      guard request == competitionRequest else { return }
      competition = .failed(previous)
    }
  }
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
  var isRunning: Bool { !startsMS.isEmpty }

  init(snapshot: PersonalAnalyticsSnapshot, day: PersonalDailySummary) {
    asOfMS = snapshot.asOfMS
    dayEndMS = day.endMS
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
