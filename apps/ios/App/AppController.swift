import FoldingDomain
import Foundation
import SwiftUI

import struct FoldingData.SetupProgress

@MainActor final class AppController {
  let presentation = FoldingPresentation()
  private let runtime: TrackingRuntime
  private let preferencesStore: UserDefaults
  private var request = UUID()
  private var didLoad = false
  private let preferencesKey = "folding.preferences.v1"

  init(
    runtime: TrackingRuntime = .shared, preferencesStore: UserDefaults = .standard,
    initialPreferences: FoldingPreferences = FoldingPreferences()
  ) {
    self.runtime = runtime
    self.preferencesStore = preferencesStore
    presentation.preferences = initialPreferences
    if let data = preferencesStore.data(forKey: preferencesKey),
      let preferences = try? JSONDecoder().decode(FoldingPreferences.self, from: data),
      preferences.schemaVersion == 1, TimeZone(identifier: preferences.homeTimezone) != nil
    {
      presentation.preferences = preferences
    } else if let data = try? JSONEncoder().encode(initialPreferences) {
      // Capture the home timezone once; travel must not silently regroup prior history.
      preferencesStore.set(data, forKey: preferencesKey)
    }
  }

  var actions: FoldingActions {
    FoldingActions(
      refresh: { try await self.refresh() },
      setup: { action in try await self.runtime.setup(action) },
      savePreferences: { preferences in
        guard preferences.schemaVersion == 1, TimeZone(identifier: preferences.homeTimezone) != nil,
          preferences.dailyLimit > 0, Set(preferences.metrics).count == preferences.metrics.count
        else { throw AnalyticsError.invalidRange }
        let data = try JSONEncoder().encode(preferences)
        self.preferencesStore.set(data, forKey: self.preferencesKey)
        self.presentation.preferences = preferences
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      loadHistory: { period, offset in try await self.history(period, offset: offset) },
      useThisPhone: {
        try await self.runtime.useThisPhone()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      reset: {
        self.presentation.dismissExports()
        try await self.runtime.reset()
        try await self.refresh()
        await self.presentation.requestHistory(using: self.actions)
      },
      export: { choice in
        try await self.runtime.prepareExport(
          choice == .json ? .json : .csv,
          homeTimezone: self.presentation.preferences.homeTimezone)
      },
      exportURL: { id in try await self.runtime.exportURL(id) },
      exportFinished: { id in
        do { try await self.runtime.finishExport(id) } catch {
          self.presentation.error = String(
            localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
        }
      })
  }

  func watch() async {
    for await _ in await runtime.updates() {
      if Task.isCancelled { return }
      await refreshVisible()
    }
  }

  func refreshVisible() async {
    do {
      try await runtime.cleanupExports()
    } catch is CancellationError {
      return
    } catch {
      presentation.error = String(
        localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
    }
    do {
      try await refresh()
      if presentation.history != nil {
        await presentation.requestHistory(using: actions)
      }
    } catch is CancellationError {} catch {
      presentation.personalFailure = String(
        localized: "tracking.unavailable", defaultValue: "Tracking unavailable")
    }
  }

  func refresh() async throws {
    let token = UUID()
    request = token
    let store = try await runtime.store()
    let now = TrackingRuntime.nowMS
    let timezone = presentation.preferences.homeTimezone
    let range = try PersonalDateRange.trailingDays(7, throughMS: now, homeTimezone: timezone)
    let analytics = try await store.analytics(homeTimezone: timezone, asOfMS: now, range: range)
    let setup = try await store.setupProgress(nowMS: now)
    let lastEvent = try await store.lastObservedAtMS()
    guard request == token, !Task.isCancelled else { return }
    if let previous = presentation.analytics, previous.generation != analytics.generation {
      presentation.dismissExports()
      try await runtime.cancelExports()
      guard request == token, !Task.isCancelled else { return }
    }
    presentation.localDeviceID = store.deviceID
    presentation.lastEventAt = lastEvent.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    presentation.analytics = analytics
    presentation.setup = setup
    presentation.personalFailure = nil
    if !didLoad {
      didLoad = true
      // Presentation-only preference; authoritative setup success remains in the journal.
      if !preferencesStore.bool(forKey: "folding.didPresentInitialSetup") {
        preferencesStore.set(true, forKey: "folding.didPresentInitialSetup")
        presentation.present(.setup)
      }
    }
  }

  func refreshAtDayBoundary() async {
    guard let endMS = presentation.analytics?.range.endMS else { return }
    do {
      let remaining = max(0, endMS - TrackingRuntime.nowMS)
      try await Task.sleep(for: .milliseconds(remaining))
      guard !Task.isCancelled else { return }
      await refreshVisible()
    } catch is CancellationError {} catch {}
  }

  func observeSetupAttempt() async {
    guard let attempt = presentation.setup?.attemptID, presentation.setup?.step.isWaiting == true
    else { return }
    do {
      let store = try await runtime.store()
      while !Task.isCancelled, presentation.setup?.attemptID == attempt,
        presentation.setup?.step.isWaiting == true
      {
        let progress = try await store.setupProgress(nowMS: TrackingRuntime.nowMS)
        guard !Task.isCancelled, presentation.setup?.attemptID == attempt else { return }
        presentation.setup = progress
        if !progress.step.isWaiting {
          try await refresh()
          return
        }
        try await Task.sleep(for: .milliseconds(500))
      }
    } catch is CancellationError {} catch {
      presentation.error = String(
        localized: "setup.testUnavailable", defaultValue: "Couldn’t check the test. Try again.")
    }
  }

  private func history(_ period: HistoryPeriod, offset: Int) async throws -> HistoryPresentation {
    let domainPeriod: PersonalHistoryPeriod
    switch period {
    case .day: domainPeriod = .day
    case .week: domainPeriod = .week
    case .month: domainPeriod = .month
    case .all: domainPeriod = .all
    }
    let zone = presentation.preferences.homeTimezone
    let store = try await runtime.store()
    let result = try await store.history(
      homeTimezone: zone, asOfMS: TrackingRuntime.nowMS, period: domainPeriod, offset: offset)
    let format = DateFormatter()
    format.timeZone = TimeZone(identifier: zone)
    switch period {
    case .day: format.setLocalizedDateFormatFromTemplate("j")
    case .week: format.dateFormat = "EEE"
    case .month: format.dateFormat = "d"
    case .all: format.dateFormat = "MMM yyyy"
    }
    let range = result.analytics.range
    let start = Date(timeIntervalSince1970: Double(range.startMS) / 1000)
    let end = Date(timeIntervalSince1970: Double(range.endMS) / 1000)
    let interval = DateIntervalFormatter()
    interval.dateStyle = .medium
    interval.timeStyle = .none
    interval.timeZone = TimeZone(identifier: zone)
    return HistoryPresentation(
      title: interval.string(from: start, to: end.addingTimeInterval(-0.001)),
      folds: result.bins.reduce(0) { $0 + $1.folds },
      completeDurationMS: result.analytics.days.reduce(0) { $0 + $1.completeDurationMS },
      bins: result.bins.map { bin in
        let start = Date(timeIntervalSince1970: Double(bin.startMS) / 1000)
        return HistoryBin(
          start: start, end: Date(timeIntervalSince1970: Double(bin.endMS) / 1000),
          label: format.string(from: start), folds: bin.folds)
      },
      sessions: result.analytics.sessions.filter {
        $0.startMS < range.endMS && ($0.endMS ?? Int64.max) > range.startMS
      },
      canGoNext: result.canGoNext)
  }
}
