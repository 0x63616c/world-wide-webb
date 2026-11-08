import AuthenticationServices
import Charts
import FoldingData
import FoldingDomain
import StoreKit
import SwiftUI
import UIKit

struct FoldingRootView: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var historyPath: [HistoryRoute] = []

  var body: some View {
    Group {
      if !model.hasLoadedInitialState {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if model.showInitialSetup {
        SetupScreen(model: model, actions: actions)
      } else {
        TabView(selection: $model.selectedTab) {
          Tab(
            String(localized: "tab.today", defaultValue: "Today"), systemImage: "chart.bar",
            value: .today
          ) {
            NavigationStack {
              TodayScreen(model: model, actions: actions)
                .navigationTitle(String(localized: "tab.today", defaultValue: "Today"))
            }
          }
          Tab(
            String(localized: "tab.history", defaultValue: "History"), systemImage: "clock",
            value: .history
          ) {
            NavigationStack(path: $historyPath) {
              HistoryScreen(model: model, actions: actions)
                .navigationTitle(String(localized: "tab.history", defaultValue: "History"))
                .navigationDestination(for: HistoryRoute.self) { route in
                  switch route {
                  case .session(let session):
                    SessionScreen(session: session, model: model, actions: actions)
                  }
                }
            }
          }
          Tab(
            String(localized: "tab.leaderboard", defaultValue: "Leaderboard"),
            systemImage: "trophy",
            value: .leaderboard
          ) {
            NavigationStack {
              LeaderboardScreen(model: model, actions: actions)
                .navigationTitle(String(localized: "tab.leaderboard", defaultValue: "Leaderboard"))
                .toolbar {
                  if model.competitionJoined {
                    ToolbarItem(placement: .topBarLeading) {
                      Button {
                        model.present(.competition(.profile))
                      } label: {
                        Image(systemName: "person.crop.circle")
                      }
                      .accessibilityLabel(
                        String(localized: "profile.title", defaultValue: "Profile"))
                    }
                  }
                }
            }
          }
          Tab(
            String(localized: "settings.title", defaultValue: "Settings"),
            systemImage: "gearshape", value: .settings
          ) {
            SettingsScreen(model: model, actions: actions)
          }
        }
      }
    }
    .fontDesign(.rounded)
    .buttonBorderShape(.roundedRectangle(radius: FoldingShape.cornerRadius))
    .tabViewStyle(.tabBarOnly)
    .tabBarMinimizeBehavior(.never)
    .tint(FoldingTint.color)
    .environment(\.timeZone, TimeZone(identifier: model.preferences.homeTimezone) ?? .current)
    .preferredColorScheme(model.preferences.appearance.scheme)
    .sheet(item: ordinarySheet, onDismiss: model.didDismissSheet) { sheet in
      sheetContent(sheet)
        .preferredColorScheme(model.preferences.appearance.scheme)
        .tint(FoldingTint.color)
        .modifier(FoldingFeedback(model: model, presentsAlert: true))
    }
    .fullScreenCover(isPresented: setupPresented, onDismiss: model.didDismissSheet) {
      SetupScreen(model: model, actions: actions)
        .preferredColorScheme(model.preferences.appearance.scheme)
        .tint(FoldingTint.color)
        .modifier(FoldingFeedback(model: model, presentsAlert: true))
    }
    .modifier(FoldingFeedback(model: model, presentsAlert: model.sheet == nil))
  }

  private var ordinarySheet: Binding<PresentedSheet?> {
    Binding(get: { model.sheet == .setup ? nil : model.sheet }, set: { model.sheet = $0 })
  }

  private var setupPresented: Binding<Bool> {
    Binding(get: { model.sheet == .setup }, set: { if !$0 { model.sheet = nil } })
  }

  @ViewBuilder private func sheetContent(_ sheet: PresentedSheet) -> some View {
    switch sheet {
    case .settings: SettingsScreen(model: model, actions: actions)
    case .competition(let screen):
      CompetitionSheetScreen(screen: screen, model: model, actions: actions)
    case .trackingPhone:
      NavigationStack {
        TrackingPhoneScreen(model: model, actions: actions)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
            }
          }
      }
    case .editSummary: SummaryEditor(model: model, actions: actions)
    case .patterns: PatternsScreen(model: model, actions: actions)
    case .leaderboardInfo:
      let periodTitle = model.competition.previous?.periodTitle ?? ""
      InformationSheet(
        title: String(localized: "leaderboard.period", defaultValue: "Period"),
        text: String(
          localized: "leaderboard.periodTimezone",
          defaultValue: "\(periodTitle) · UTC"))
    case .tiedRank(let rank):
      NavigationStack {
        List(
          model.competition.previous?.entries.filter {
            $0.rank == rank && !model.hiddenParticipantIDs.contains($0.id)
          } ?? []
        ) { entry in
          LeaderboardRow(entry: entry).contextMenu {
            ParticipantMenu(entry: entry, model: model, actions: actions)
          }
        }
        .navigationTitle(String(localized: "leaderboard.tiedRank", defaultValue: "Tied places"))
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
          }
        }
      }
    case .export(let ticket):
      ExportShareHost(ticket: ticket, model: model, actions: actions)
    case .setup: EmptyView()
    }
  }

}

private struct TodayScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  private var today: PersonalDailySummary? {
    guard let snapshot = model.analytics else { return nil }
    return snapshot.days.first { $0.startMS <= snapshot.asOfMS && snapshot.asOfMS < $0.endMS }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        if let failure = model.personalFailure, model.analytics != nil {
          Label(failure, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(
            .secondary)
        } else if model.needsSetup && model.personalFailure == nil {
          Button {
            model.present(.setup)
          } label: {
            Label(
              String(localized: "setup.start", defaultValue: "Set up tracking"),
              systemImage: "iphone"
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
          }
        } else if model.privateHistoryHealth?.requiresAttention == true {
          Button {
            model.selectedTab = .settings
          } label: {
            Label(
              String(localized: "recovery.title", defaultValue: "History needs attention"),
              systemImage: "exclamationmark.triangle"
            )
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
          }
        } else if model.analytics?.needsDeviceSelection == true {
          Button {
            model.present(.trackingPhone)
          } label: {
            Label(
              String(localized: "phone.choose", defaultValue: "Choose tracking phone"),
              systemImage: "iphone.gen3"
            )
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
          }
        } else if let value = model.syncStatus,
          value.publicTracking && (value.resetPending || value.pendingFolds > 0)
        {
          Label {
            if value.resetPending {
              Text(String(localized: "sync.resetPending", defaultValue: "Reset pending"))
            } else {
              Text(
                String(
                  localized: "leaderboard.pending", defaultValue: "\(value.pendingFolds) pending")
              )
            }
          } icon: {
            Image(systemName: "arrow.triangle.2.circlepath")
          }
          .font(.subheadline).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
        } else if let status = model.status {
          Label(status, systemImage: "arrow.triangle.2.circlepath").font(.subheadline)
            .foregroundStyle(.secondary)
        }
        if let today {
          ForEach(Array(metricRows.enumerated()), id: \.offset) { _, row in
            HStack(spacing: 12) {
              ForEach(row) { metric in
                metricView(metric, today: today)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .padding(20)
                  .frame(minHeight: 108, alignment: .leading)
                  .background(
                    Color(uiColor: .secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius)
                  )
                  .draggable(metric.rawValue)
                  .dropDestination(for: String.self) { values, _ in
                    guard let raw = values.first, let moved = SummaryMetric(rawValue: raw),
                      model.preferences.orderedCards.contains(moved), moved != metric
                    else { return false }
                    var next = model.preferences
                    next.moveCard(moved, to: metric)
                    let saved = next
                    Task {
                      await model.command(
                        String(localized: "settings.saving", defaultValue: "Saving")
                      ) {
                        try await actions.savePreferences(saved)
                      }
                    }
                    return true
                  }
                  .contextMenu {
                    Button(String(localized: "today.editSummary", defaultValue: "Edit Summary")) {
                      model.present(.editSummary)
                    }
                  }

              }
            }
          }
          Button(String(localized: "today.editSummary", defaultValue: "Edit Summary")) {
            model.present(.editSummary)
          }
          .font(.subheadline)
        } else if model.personalFailure != nil {
          ContentUnavailableView(
            String(localized: "tracking.unavailable", defaultValue: "Tracking unavailable"),
            systemImage: "exclamationmark.icloud")
        } else {
          ProgressView().frame(maxWidth: .infinity).padding(.vertical, 48)
        }
      }
      .frame(maxWidth: 1100, alignment: .leading)
      .padding(16)
      .frame(maxWidth: .infinity)
    }
    .background(Color(uiColor: .systemGroupedBackground))
    .refreshable {
      await model.command(String(localized: "action.refreshing", defaultValue: "Refreshing")) {
        try await actions.refresh()
      }
    }
  }

  private var metricRows: [[SummaryMetric]] {
    var rows: [[SummaryMetric]] = []
    for metric in model.preferences.orderedCards
    where metric != .competitionComparison || model.competitionJoined {
      let compact = Self.isCompact(metric)
      if compact, let last = rows.indices.last, rows[last].count == 1,
        Self.isCompact(rows[last][0])
      {
        rows[last].append(metric)
      } else {
        rows.append([metric])
      }
    }
    return rows
  }

  private static func isCompact(_ metric: SummaryMetric) -> Bool {
    switch metric {
    case .opens, .closes, .cycles, .lifetimeFolds: true
    default: false
    }
  }

  @ViewBuilder private func metricView(_ metric: SummaryMetric, today: PersonalDailySummary)
    -> some View
  {
    switch metric {
    case .competitionComparison:
      if model.competitionJoined {
        Button {
          model.selectedTab = .leaderboard
        } label: {
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(metric.title).font(.subheadline).foregroundStyle(.secondary)
              Spacer()
              if let board = model.competition.previous {
                Text(board.periodTitle).font(.caption).foregroundStyle(.secondary)
              }
            }
            if let entry = model.competition.previous?.currentUser {
              HStack {
                Label(entry.rank.formatted(), systemImage: "trophy")
                  .font(.title2.weight(.semibold)).monospacedDigit()
                  .accessibilityLabel(String(localized: "results.place", defaultValue: "Place"))
                  .accessibilityValue(entry.rank.formatted())
                Spacer()
                MetricRow(
                  title: String(localized: "metric.folds", defaultValue: "Folds"),
                  value: entry.folds.formatted())
              }
            } else {
              Image(systemName: "chevron.right").frame(minHeight: 44)
            }
          }.contentShape(Rectangle())
        }.buttonStyle(.plain)
      }

    case .timeUnfolded:
      if let snapshot = model.analytics {
        let running = RunningDurationPresentation(snapshot: snapshot, day: today)
        TimelineView(.periodic(from: .now, by: 1)) { context in
          let durationMS = running.durationMS(at: context.date)
          HStack(alignment: .lastTextBaseline) {
            MetricRow(
              title: metric.title,
              value: Duration.milliseconds(running.totalDurationMS(at: context.date)).formatted(
                .units(
                  allowed: [.hours, .minutes, .seconds], width: .abbreviated, maximumUnitCount: 3)))
            Spacer(minLength: 0)
            if running.isRunning {
              Image(systemName: "timer").foregroundStyle(.secondary)
                .accessibilityLabel(
                  String(
                    localized: "session.runningDuration",
                    defaultValue:
                      "Running, \(foldingDuration(durationMS))"))
            }
          }
        }
      } else {
        MetricRow(title: metric.title, value: foldingDuration(today.completeDurationMS))
      }
    case .trend:
      VStack(alignment: .leading, spacing: 12) {
        Text(metric.title).font(.headline)
        if let snapshot = model.analytics {
          Chart(0..<snapshot.days.count, id: \.self) { index in
            let day = snapshot.days[index]
            BarMark(
              x: .value(
                String(localized: "chart.date", defaultValue: "Date"),
                index),
              y: .value(String(localized: "metric.folds", defaultValue: "Folds"), day.folds),
              width: .fixed(20)
            )
            .foregroundStyle(
              day.startMS == snapshot.days.last?.startMS
                ? FoldingTint.color : FoldingTint.color.opacity(0.55)
            )
            .cornerRadius(5)
            .accessibilityLabel(day.date)
            .accessibilityValue(day.folds.formatted())
          }
          .chartXAxis {
            AxisMarks(preset: .aligned, values: Array(snapshot.days.indices)) { value in
              AxisValueLabel(centered: false, anchor: .top, offsetsMarks: false) {
                if let index = value.as(Int.self), snapshot.days.indices.contains(index) {
                  Text(
                    Date(timeIntervalSince1970: Double(snapshot.days[index].startMS) / 1000),
                    format: .dateTime.weekday(.abbreviated))
                }
              }
            }
          }
          .chartYAxis(.hidden)
          .chartXScale(domain: -0.5...(Double(snapshot.days.count) - 0.5))
          .frame(height: 132)
          .accessibilityLabel(metric.title)
        }
      }
    case .opens: MetricRow(title: metric.title, value: today.opens.formatted())
    case .closes: MetricRow(title: metric.title, value: today.closes.formatted())
    case .cycles: MetricRow(title: metric.title, value: today.cycles.formatted())
    case .lifetimeFolds:
      MetricRow(title: metric.title, value: model.analytics?.lifetime.folds.formatted() ?? "—")
    case .folds:
      MetricRow(title: metric.title, value: today.folds.formatted(), prominent: true)

    }
  }
}

private struct MetricRow: View {
  let title: String
  let value: String
  var prominent = false
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title).font(.subheadline).foregroundStyle(.secondary)
      Spacer(minLength: 8)
      Text(value).font(
        prominent
          ? .system(.largeTitle, design: .rounded, weight: .bold)
          : .title2.weight(.semibold)
      ).monospacedDigit()
    }
    .frame(minHeight: 72, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

private struct HistoryScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var selectedBinIndex: Int?

  var body: some View {
    GeometryReader { geometry in
      if geometry.size.width >= 700 {
        ScrollView {
          HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 18) { summaryContent }
              .padding(20)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius))
            VStack(alignment: .leading, spacing: 12) {
              if model.history != nil {
                Text(String(localized: "history.sessions", defaultValue: "Sessions"))
                  .font(.headline)
                ScrollView {
                  LazyVStack(alignment: .leading, spacing: 16) { sessionsContent }
                }
                .frame(height: max(240, geometry.size.height - 120))
              }
            }
            .padding(20)
            .frame(width: min(380, geometry.size.width * 0.38), alignment: .leading)
            .background(
              Color(uiColor: .secondarySystemGroupedBackground),
              in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius))
          }
          .padding(20)
        }
        .background(Color(uiColor: .systemGroupedBackground))
      } else {
        List {
          Section { summaryContent }
          if model.history != nil {
            Section(String(localized: "history.sessions", defaultValue: "Sessions")) {
              ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) { sessionsContent }
                  .padding(.vertical, 8)
              }
              .frame(height: min(360, max(160, geometry.size.height * 0.45)))
            }
          }
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          model.present(.patterns)
        } label: {
          Image(systemName: "chart.bar")
        }
        .accessibilityLabel(String(localized: "patterns.title", defaultValue: "Patterns"))
        .disabled(actions.loadPatterns == nil)
      }
    }
    .overlay(alignment: .top) {
      if model.historyLoading, model.history != nil { ProgressView().padding(8) }
    }
    .onChange(of: model.historyPeriod) { _, _ in model.historyOffset = 0 }
    .task(id: "\(model.historyPeriod.rawValue)-\(model.historyOffset)") {
      await model.requestHistory(using: actions)
    }
  }

  @ViewBuilder private var summaryContent: some View {
    Picker(
      String(localized: "history.interval", defaultValue: "Interval"),
      selection: $model.historyPeriod
    ) {
      ForEach(HistoryPeriod.allCases) { Text($0.title).tag($0) }
    }.pickerStyle(.segmented)
      .disabled(actions.loadHistory == nil)
      .listRowSeparator(.hidden)
    if let history = model.history {
      HStack {
        Button {
          model.historyOffset -= 1
        } label: {
          Image(systemName: "chevron.left")
        }.buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
          .accessibilityLabel(
            String(localized: "history.previous", defaultValue: "Previous period")
          )
          .disabled(actions.loadHistory == nil || model.historyLoading || !history.canGoPrevious)
        Text(history.title).font(.headline).frame(maxWidth: .infinity)
        Button {
          model.historyOffset += 1
        } label: {
          Image(systemName: "chevron.right")
        }.buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
          .accessibilityLabel(String(localized: "history.next", defaultValue: "Next period"))
          .disabled(
            model.historyOffset >= 0 || actions.loadHistory == nil
              || model.historyPeriod == .all)
      }.listRowSeparator(.hidden)
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(history.folds, format: .number)
          .font(.system(size: 44, weight: .bold, design: .rounded))
          .monospacedDigit()
        Text(String(localized: "metric.folds", defaultValue: "Folds"))
          .font(.subheadline).foregroundStyle(.secondary)
      }.listRowSeparator(.hidden)
      if !history.bins.isEmpty {
        Chart(0..<history.bins.count, id: \.self) { index in
          let bin = history.bins[index]
          BarMark(
            x: .value(String(localized: "chart.date", defaultValue: "Date"), index),
            y: .value(String(localized: "metric.folds", defaultValue: "Folds"), bin.folds),
            width: .fixed(history.bins.count > 14 ? 10 : 24)
          )
          .foregroundStyle(
            selectedBinIndex.map({ $0 == index }) == false
              ? FoldingTint.color.opacity(0.4) : FoldingTint.color
          )
          .cornerRadius(5)
          .accessibilityLabel(bin.label).accessibilityValue(bin.folds.formatted())
        }
        .chartXScale(domain: -0.5...(Double(history.bins.count) - 0.5))
        .chartYAxis(.hidden)
        .chartXAxis {
          AxisMarks(
            preset: .aligned,
            values: Array(
              stride(
                from: 0, to: history.bins.count,
                by: max(1, Int(ceil(Double(history.bins.count) / 7)))))
          ) { value in
            AxisValueLabel(centered: false, anchor: .top, offsetsMarks: false) {
              if let index = value.as(Int.self), history.bins.indices.contains(index) {
                Text(history.bins[index].label)
              }
            }
          }
        }
        .chartXSelection(value: $selectedBinIndex)
        .onChange(of: history.bins.map(\.start)) { _, _ in selectedBinIndex = nil }
        .frame(height: 180)
        .listRowSeparator(.hidden)
        if let index = selectedBinIndex, history.bins.indices.contains(index) {
          HStack {
            if model.historyPeriod == .month {
              Text(history.bins[index].start, format: .dateTime.month(.wide).day())
            } else {
              Text(history.bins[index].label)
            }
            Spacer()
            Text(history.bins[index].folds, format: .number).monospacedDigit()
          }
        }
      }
      if model.entryDeletionPending {
        Label(
          String(localized: "history.deletionPending", defaultValue: "Leaderboard update pending"),
          systemImage: "clock"
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      if model.historyFailed {
        Button(String(localized: "action.retry", defaultValue: "Retry")) {
          Task { await model.requestHistory(using: actions) }
        }
      }
    } else if model.historyLoading {
      ProgressView().frame(maxWidth: .infinity)
    } else {
      ContentUnavailableView(
        String(localized: "history.unavailable", defaultValue: "History unavailable"),
        systemImage: "clock")
    }
  }

  @ViewBuilder private var sessionsContent: some View {
    if let history = model.history {
      if history.sessions.isEmpty {
        Text(String(localized: "history.noSessions", defaultValue: "No sessions yet"))
          .foregroundStyle(.secondary)
      }
      ForEach(Array(history.sessions.enumerated()), id: \.offset) { _, session in
        NavigationLink(value: HistoryRoute.session(SessionPresentation(session))) {
          HStack {
            Text(
              Date(timeIntervalSince1970: Double(session.startMS) / 1000),
              format: .dateTime.month(.abbreviated).day().hour().minute())
            Spacer()
            Text(session.durationMS.map(foldingDuration) ?? session.completeness.title)
              .foregroundStyle(.secondary)
          }
        }
        .buttonStyle(.plain)
      }
    }
  }
}

private struct SessionScreen: View {
  let session: SessionPresentation
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingDeletion = false
  var body: some View {
    Form {
      LabeledContent(String(localized: "session.opened", defaultValue: "Opened")) {
        Text(session.start, format: .dateTime.month().day().hour().minute())
      }
      if let end = session.end {
        LabeledContent(String(localized: "session.closed", defaultValue: "Closed")) {
          Text(end, format: .dateTime.month().day().hour().minute())
        }
      }
      LabeledContent(
        String(localized: "metric.timeUnfolded", defaultValue: "Time unfolded"),
        value: session.durationMS.map(foldingDuration) ?? "—")
      Label(
        session.completeness.title,
        systemImage: session.completeness == .incomplete ? "exclamationmark.circle" : "clock")
    }
    .toolbar {
      if session.completeness == .incomplete, actions.deleteIncompleteEntry != nil {
        ToolbarItem(placement: .topBarTrailing) {
          Button(role: .destructive) {
            confirmingDeletion = true
          } label: {
            Image(systemName: "trash")
          }
          .accessibilityLabel(
            String(localized: "history.deleteEntry", defaultValue: "Delete entry")
          )
          .disabled(model.operation != nil)
        }
      }
    }
    .confirmationDialog(
      String(localized: "history.deleteTitle", defaultValue: "Delete this entry?"),
      isPresented: $confirmingDeletion, titleVisibility: .visible
    ) {
      Button(
        String(localized: "history.deleteEntry", defaultValue: "Delete entry"), role: .destructive
      ) {
        guard let remove = actions.deleteIncompleteEntry else { return }
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await remove(session.deletionTarget)
            dismiss()
          }
        }
      }
    } message: {
      Text(
        String(
          localized: "history.deleteEffect",
          defaultValue: "Removes its folds from your totals and leaderboards."))
    }
    .navigationTitle(String(localized: "history.session", defaultValue: "Session"))
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct SettingsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var resetConfirmation = false
  @State private var isTestFlight = false

  private var versionDescription: String {
    let version =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    return "\(version) (\(build))" + (isTestFlight ? " · TestFlight" : "")
  }

  var body: some View {
    NavigationStack {
      Form {
        Section(String(localized: "settings.appearance", defaultValue: "Appearance")) {
          Picker(
            String(localized: "settings.theme", defaultValue: "Theme"),
            selection: preference(\.appearance)
          ) {
            ForEach(FoldingAppearance.allCases) { Text($0.title).tag($0) }
          }

        }
        Section(String(localized: "tab.today", defaultValue: "Today")) {
          Button(String(localized: "today.editSummary", defaultValue: "Edit Summary")) {
            model.present(.editSummary)
          }

        }
        Section(String(localized: "settings.tracking", defaultValue: "Tracking")) {
          LabeledContent(String(localized: "settings.setup", defaultValue: "Setup")) {
            HStack(spacing: 6) {
              if !model.needsSetup {
                Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.green)
              }
              Text(
                model.needsSetup
                  ? String(localized: "settings.setupRequired", defaultValue: "Not complete")
                  : String(localized: "settings.setupComplete", defaultValue: "Tested"))
            }
          }
          if let last = model.lastEventAt {
            LabeledContent(String(localized: "settings.lastEvent", defaultValue: "Last event")) {
              Text(last, format: .dateTime.month(.abbreviated).day().hour().minute())
            }
          }
          Button(String(localized: "settings.runSetup", defaultValue: "Run setup again")) {
            Task {
              await model.command(
                String(localized: "setup.starting", defaultValue: "Starting setup")
              ) {
                model.setup = try await actions.setup(.restart)
                model.present(.setup)
              }
            }
          }
          NavigationLink {
            TrackingPhoneScreen(model: model, actions: actions)
          } label: {
            LabeledContent(
              String(localized: "phone.title", defaultValue: "Tracking phone"),
              value: model.trackingPhoneSelection?.title ?? "—")
          }
          if let sync = model.syncStatus {
            LabeledContent(String(localized: "sync.iCloud", defaultValue: "iCloud")) {
              Text(syncTitle(sync.iCloud))
            }
            if sync.publicTracking && sync.pendingFolds > 0 {
              LabeledContent(
                String(localized: "sync.pendingFolds", defaultValue: "Pending folds"),
                value: sync.pendingFolds.formatted())
            }
          }
        }
        Section {
          NavigationLink(String(localized: "notifications.title", defaultValue: "Notifications")) {
            NotificationSettingsScreen(model: model, actions: actions)
          }
        }
        Section(String(localized: "settings.data", defaultValue: "Data")) {
          if model.privateHistoryHealth?.requiresAttention == true {
            NavigationLink {
              HistoryRecoveryScreen(
                model: model, actions: actions,
                export: { export(.csv) }, reset: { resetConfirmation = true })
            } label: {
              Label(
                String(localized: "recovery.title", defaultValue: "History needs attention"),
                systemImage: "exclamationmark.triangle")
            }
          }
          if actions.export != nil, actions.exportURL != nil {
            Button(String(localized: "data.export", defaultValue: "Export")) {
              export(.csv)
            }
          }
          if actions.reset != nil {
            Button(
              String(localized: "data.reset", defaultValue: "Reset history"), role: .destructive
            ) { resetConfirmation = true }
            .disabled(!model.canResetHistory)
          }
        }
        Section(String(localized: "settings.support", defaultValue: "Support")) {
          NavigationLink(String(localized: "tips.title", defaultValue: "Tip jar")) {
            if let tipJar = actions.tipJar { tipJar() }
          }.disabled(actions.tipJar == nil)
          Link(
            String(localized: "support.contact", defaultValue: "Contact"),
            destination: URL(string: "mailto:support@getfolding.app")!)
          Link(
            String(localized: "support.privacy", defaultValue: "Privacy"),
            destination: URL(string: "https://getfolding.app/privacy")!)
          LabeledContent(
            String(localized: "settings.version", defaultValue: "Version"),
            value: versionDescription
          )
          .task {
            #if !DEBUG && !targetEnvironment(simulator)
              if let result = try? await AppTransaction.shared,
                case .verified(let transaction) = result
              {
                isTestFlight = transaction.environment == .sandbox
              }
            #endif
          }
        }
      }
      .disabled(model.operation != nil)
      .navigationTitle(String(localized: "settings.title", defaultValue: "Settings"))
      .navigationBarTitleDisplayMode(.inline)
      .tint(FoldingTint.color)
      .alert(
        String(localized: "reset.title", defaultValue: "Reset history?"),
        isPresented: $resetConfirmation
      ) {
        Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
        Button(
          String(localized: "reset.confirm", defaultValue: "Reset History"), role: .destructive
        ) {
          Task { await model.requestReset(using: actions) }
        }
      } message: {
        Text(
          String(
            localized: "reset.message",
            defaultValue: "Deletes history, scores and medals."))
      }
    }
    .interactiveDismissDisabled(model.operation != nil)
  }

  private func preference<Value>(_ key: WritableKeyPath<FoldingPreferences, Value>) -> Binding<
    Value
  > {
    Binding(
      get: { model.preferences[keyPath: key] },
      set: { value in
        let previous = model.preferences
        var next = previous
        next[keyPath: key] = value
        model.preferences = next
        Task {
          do {
            try await actions.savePreferences(next)
          } catch {
            if model.preferences == next { model.preferences = previous }
            model.error = String(
              localized: "error.tryAgain", defaultValue: "Something went wrong.")
          }
        }
      })
  }

  private func export(_ format: ExportChoice) {
    Task { await model.requestExport(format, using: actions) }
  }

  private func syncTitle(_ state: PrivateSyncAvailability) -> String {
    switch state {
    case .available: String(localized: "sync.available", defaultValue: "Available")
    case .localOnly: String(localized: "sync.localOnly", defaultValue: "On this iPhone")
    case .unavailable: String(localized: "sync.unavailable", defaultValue: "Unavailable")
    case .checking: "—"
    }
  }

}

private struct SummaryEditor: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var ordered: [SummaryMetric] = []

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(ordered) { metric in
            Toggle(
              metric.title,
              isOn: Binding(
                get: { metric == .folds || model.preferences.metrics.contains(metric) },
                set: { enabled in
                  var next = model.preferences
                  next.metrics = ordered.filter {
                    $0 != .folds && ($0 == metric ? enabled : next.metrics.contains($0))
                  }
                  next.cardOrder = ordered
                  save(next)
                })
            )
            .tint(.black)
            .disabled(metric == .folds)
          }.onMove { source, destination in
            ordered.move(fromOffsets: source, toOffset: destination)
            var next = model.preferences
            next.metrics = ordered.filter { $0 != .folds && next.metrics.contains($0) }
            next.cardOrder = ordered
            save(next)
          }
        }
      }
      .environment(\.editMode, .constant(.active))
      .disabled(model.operation != nil)
      .navigationTitle(String(localized: "today.editSummary", defaultValue: "Edit Summary"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
        }
      }
      .onAppear {
        ordered =
          (model.preferences.orderedCards
          + SummaryMetric.allCases.filter { !model.preferences.orderedCards.contains($0) })
          .filter { $0 != .competitionComparison || model.competitionJoined }
      }
    }
  }
  private func save(_ proposed: FoldingPreferences) {
    var next = proposed
    if !model.competitionJoined && model.preferences.metrics.contains(.competitionComparison)
      && !next.metrics.contains(.competitionComparison)
    {
      next.metrics.append(.competitionComparison)
    }
    let saved = next
    Task {
      await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
        try await actions.savePreferences(saved)
        model.preferences = saved
      }
    }
  }
}

private enum HingePosture { case closed, partiallyOpen, fullyOpen }

private struct SetupScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var hinge: HingePosture?
  @State private var shouldAutoTest = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var step: SetupStep { model.setup?.step ?? .welcome }
  private var closing: Bool {
    [.closingInstructions, .closingReady, .awaitingClosing, .closingPassed, .closingRetry].contains(
      step)
  }
  private var passed: Bool { step == .openingPassed || step == .closingPassed || step == .complete }
  private var instructions: String? {
    closing ? actions.closingInstructions : actions.openingInstructions
  }
  private var readyForTest: Bool {
    guard let hinge else { return false }
    if step == .openingReady { return hinge == .closed }
    if step == .closingReady { return hinge != .closed }
    return true
  }
  private var showingAutomationInstructions: Bool {
    step == .openingInstructions || step == .closingInstructions
  }
  private var compactIllustration: Bool { true }

  @ViewBuilder var body: some View {
    if #available(iOS 27.1, *) {
      content.onHingeChange { _, context in
        guard let status = context.hinge?.status else {
          hinge = nil
          return
        }
        if status == .closed {
          hinge = .closed
        } else if status == .fullyOpen {
          hinge = .fullyOpen
        } else {
          hinge = .partiallyOpen
        }
      }
    } else {
      content
    }
  }

  private var content: some View {
    NavigationStack {
      GeometryReader { geometry in
        ScrollView {
          VStack(spacing: 16) {
            FoldIllustration(
              open: hinge.map { $0 != .closed } ?? !closing, success: passed,
              compact: compactIllustration
            )
            .id(step)
            .frame(height: 112)
            .accessibilityHidden(true)
            Text(title).font(.largeTitle.bold()).multilineTextAlignment(.center)
            if let hinge, step.isWaiting || shouldAutoTest {
              Label(hingeStatus(hinge), systemImage: "iphone.gen3")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            }
            if let sentence {
              Text(sentence).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            if step.isWaiting { ProgressView().padding(.top, 8) }
            if showingAutomationInstructions || step == .openingReady || step == .closingReady
              || step == .openingRetry || step == .closingRetry
            {
              automationGuide
            }
            if step == .openingRetry || step == .closingRetry {
              Button(String(localized: "action.retry", defaultValue: "Retry")) {
                shouldAutoTest = true
                perform(.retry)
              }
              .buttonStyle(.bordered)
            }
            if showingAutomationInstructions {
              Button(String(localized: "setup.addedAutomation", defaultValue: "I've added it")) {
                shouldAutoTest = true
                perform(.next)
              }
              .buttonStyle(.borderedProminent)
              .foregroundStyle(FoldingTint.onTint)
              .disabled(model.operation != nil)
            }
            if (step == .openingReady || step == .closingReady)
              && (!shouldAutoTest || hinge == nil)
            {
              Button(String(localized: "setup.startTest", defaultValue: "Start test")) {
                if hinge == nil {
                  perform(.test)
                } else {
                  shouldAutoTest = true
                  beginTestWhenReady()
                }
              }
              .buttonStyle(.borderedProminent)
              .foregroundStyle(FoldingTint.onTint)
              .disabled(model.operation != nil || (hinge != nil && !readyForTest))
            }
            if step == .complete {
              Button(String(localized: "action.done", defaultValue: "Done")) { dismissSetup() }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(FoldingTint.onTint)
            }
            if showingAutomationInstructions || step == .openingRetry || step == .closingRetry {
              DisclosureGroup(String(localized: "action.help", defaultValue: "Help")) {
                VStack(alignment: .leading, spacing: 12) {
                  if let instructions {
                    Text(instructions)
                  } else {
                    Text(
                      closing
                        ? String(
                          localized: "setup.chooseClosing",
                          defaultValue:
                            "In the editor, choose an automation for when your Duo closes.")
                        : String(
                          localized: "setup.chooseOpening",
                          defaultValue:
                            "In the editor, choose an automation for when your Duo opens."
                        ))
                  }
                  Text(
                    String(
                      localized: "setup.lockedHelp",
                      defaultValue:
                        "Allow the shortcut to run while locked."))
                  Text(
                    String(
                      localized: "setup.existingHelp",
                      defaultValue:
                        "Edit existing automations to avoid duplicates."))
                  Link(
                    String(localized: "setup.appleGuide", defaultValue: "Shortcuts guide"),
                    destination: URL(
                      string:
                        "https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios"
                    )!
                  )
                }.frame(maxWidth: .infinity, alignment: .leading)
              }.font(.subheadline)
            }
          }
          .frame(maxWidth: 480)
          .frame(minHeight: geometry.size.height, alignment: .center)
          .padding(.horizontal, 24)
          .frame(maxWidth: .infinity)
        }
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: step)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          if step != .complete {
            Button(String(localized: "setup.notNow", defaultValue: "Not now")) { dismissSetup() }
              .disabled(model.operation != nil)
          }
        }
      }
    }
    .interactiveDismissDisabled()
    .task {
      #if !FOLDING_SCREENSHOTS
        if step == .welcome { perform(.next) }
      #endif
    }
    .onChange(of: hinge) { _, _ in beginTestWhenReady() }
    .onChange(of: step) { _, next in
      if next == .openingPassed || next == .closingPassed {
        AccessibilityNotification.Announcement(
          String(localized: "setup.testPassed", defaultValue: "Test passed")
        ).post()
        Task {
          try? await Task.sleep(for: .milliseconds(700))
          if model.setup?.step == next { perform(.next) }
        }
      } else if next == .openingReady || next == .closingReady {
        beginTestWhenReady()
      }
    }
  }

  private var automationGuide: some View {
    VStack(alignment: .center, spacing: 12) {
      Text(
        closing
          ? String(localized: "setup.triggerClosed", defaultValue: "Automation → Display → Closed")
          : String(localized: "setup.triggerOpen", defaultValue: "Automation → Display → Open")
      )
      .font(.subheadline).foregroundStyle(.secondary)
      Text(
        closing
          ? String(localized: "intent.recordClosing.title", defaultValue: "Log Duo Closed")
          : String(localized: "intent.recordOpening.title", defaultValue: "Log Duo Opened")
      )
      .font(.headline)
      if let open = actions.openShortcuts {
        Button(String(localized: "setup.openShortcuts", defaultValue: "Open Shortcuts")) {
          open()
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
      }
    }
    .frame(maxWidth: .infinity, alignment: .center)
  }

  private func hingeStatus(_ status: HingePosture) -> String {
    if status == .closed {
      return String(localized: "setup.hingeClosed", defaultValue: "Closed")
    }
    if status == .fullyOpen {
      return String(localized: "setup.hingeOpen", defaultValue: "Open")
    }
    return String(localized: "setup.hingePartlyOpen", defaultValue: "Partly open")
  }

  private var title: String {
    switch step {
    case .welcome: String(localized: "setup.welcome", defaultValue: "Every fold counts")
    case .openingInstructions:
      String(localized: "setup.openingAutomation", defaultValue: "Track opening")
    case .closingInstructions:
      String(localized: "setup.closingAutomation", defaultValue: "Track closing")
    case .openingReady:
      hinge == nil || !shouldAutoTest
        ? String(localized: "setup.openingAutomation", defaultValue: "Track opening")
        : readyForTest
          ? String(localized: "setup.openDevice", defaultValue: "Open your Duo")
          : String(localized: "setup.startClosed", defaultValue: "Close your Duo first.")
    case .closingReady:
      hinge == nil || !shouldAutoTest
        ? String(localized: "setup.closingAutomation", defaultValue: "Track closing")
        : readyForTest
          ? String(localized: "setup.closeDevice", defaultValue: "Close your Duo")
          : String(localized: "setup.startOpen", defaultValue: "Open your Duo first.")
    case .awaitingOpening: String(localized: "setup.openDevice", defaultValue: "Open your Duo")
    case .awaitingClosing: String(localized: "setup.closeDevice", defaultValue: "Close your Duo")
    case .openingPassed, .closingPassed:
      String(localized: "setup.testPassed", defaultValue: "Test passed")
    case .openingRetry, .closingRetry:
      String(localized: "setup.noEvent", defaultValue: "No event yet")
    case .complete: String(localized: "setup.complete", defaultValue: "You're set")
    }
  }

  private var sentence: String? {
    switch step {
    case .welcome:
      String(
        localized: "setup.welcomeDetail",
        defaultValue: "Connect Shortcuts, then test both directions.")
    case .openingInstructions, .closingInstructions: nil
    case .openingReady:
      hinge == nil
        ? String(localized: "setup.manualOpen", defaultValue: "Start closed. Then open your Duo.")
        : nil
    case .closingReady:
      hinge == nil
        ? String(localized: "setup.manualClose", defaultValue: "Start open. Then close your Duo.")
        : nil
    case .awaitingOpening, .awaitingClosing:
      String(localized: "setup.waitingForShortcut", defaultValue: "Waiting for Shortcuts")
    default: nil
    }
  }

  private func beginTestWhenReady() {
    guard shouldAutoTest, readyForTest, step == .openingReady || step == .closingReady else {
      return
    }
    Task {
      try? await Task.sleep(for: .milliseconds(300))
      guard shouldAutoTest, readyForTest, step == .openingReady || step == .closingReady,
        model.operation == nil
      else { return }
      shouldAutoTest = false
      perform(.test)
    }
  }
  private func perform(_ action: SetupAction) {
    Task {
      await model.command(String(localized: "setup.updating", defaultValue: "Updating setup")) {
        model.setup = try await actions.setup(action)
      }
    }
  }
  private func dismissSetup() {
    Task {
      await model.command(String(localized: "setup.updating", defaultValue: "Updating setup")) {
        model.setup = try await actions.setup(.dismiss)
        model.showInitialSetup = false
        model.sheet = nil
      }
    }
  }
}

private struct FoldIllustration: View {
  let open: Bool
  let success: Bool
  let compact: Bool
  @State private var expanded = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(spacing: 4) {
      RoundedRectangle(cornerRadius: 16).fill(.primary)
      RoundedRectangle(cornerRadius: 16).fill(.primary)
        .rotation3DEffect(
          .degrees(expanded ? 0 : -70), axis: (x: 0, y: 1, z: 0),
          anchor: .leading, perspective: 0)
    }
    .frame(width: compact ? 100 : 160, height: compact ? 96 : 154)
    .overlay {
      if success {
        Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.green)
          .symbolRenderingMode(.monochrome).background(.background, in: Circle())
      }
    }
    .task(id: open) {
      expanded = reduceMotion ? open : !open
      if !reduceMotion {
        await Task.yield()
        guard !Task.isCancelled else { return }
        withAnimation(.easeInOut(duration: 0.8)) { expanded = open }
      }
    }
  }
}

private struct LeaderboardScreen: View {
  @Environment(\.colorScheme) private var colorScheme
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    Group {
      if model.competitionRemoval != nil {
        CompetitionRemovalScreen(model: model, actions: actions)
      } else {
        switch model.competition {
        case .unavailable:
          ContentUnavailableView(
            String(localized: "leaderboard.unavailable", defaultValue: "Leaderboard unavailable"),
            systemImage: "trophy")
        case .notJoined:
          VStack(spacing: 24) {
            Image(systemName: "trophy").font(.largeTitle).foregroundStyle(.secondary)
            Text(String(localized: "leaderboard.joinTitle", defaultValue: "Join Folding")).font(
              .title.bold())
            if model.competitionProfile != nil {
              Button(String(localized: "profile.continueSetup", defaultValue: "Continue setup")) {
                model.beginJoin(suggestedNickname: model.joinNickname)
              }
              .buttonStyle(.borderedProminent)
              .foregroundStyle(FoldingTint.onTint)
              .controlSize(.large)
            } else if let signIn = actions.signInCompetition {
              NativeAppleSignInButton(dark: colorScheme == .dark) {
                Task {
                  await model.command(
                    String(localized: "profile.signingIn", defaultValue: "Signing in")
                  ) { try await signIn() }
                }
              }.id(colorScheme).frame(height: 50).disabled(model.operation != nil)
            } else if let request = actions.appleRequest, let completion = actions.appleCompletion {
              SignInWithAppleButton(.continue, onRequest: request, onCompletion: completion)
                .frame(maxWidth: 320).frame(height: 50)
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            }
          }.multilineTextAlignment(.center).padding(24)
        case .banned:
          ContentUnavailableView {
            Label(
              String(localized: "leaderboard.restricted", defaultValue: "Competition restricted"),
              systemImage: "exclamationmark.shield")
          } actions: {
            Link(
              String(localized: "leaderboard.appeal", defaultValue: "Contact support"),
              destination: URL(string: "mailto:support@getfolding.app")!)
          }
        case .loading(let previous), .failed(let previous):
          if let previous {
            rankedList(previous)
          } else if case .loading = model.competition {
            ProgressView()
          } else {
            ContentUnavailableView {
              Label(
                String(
                  localized: "leaderboard.unavailable", defaultValue: "Leaderboard unavailable"),
                systemImage: "wifi.exclamationmark")
            } actions: {
              Button(String(localized: "action.retry", defaultValue: "Retry")) {
                Task { await model.requestLeaderboard(using: actions) }
              }
            }
          }
        case .loaded(let value): rankedList(value)
        }
      }
    }
    .task(id: model.competitionPeriod) {
      switch model.competition {
      case .loaded, .failed, .loading: await model.requestLeaderboard(using: actions)
      default: break
      }
    }
  }

  private func rankedList(_ value: LeaderboardPresentation) -> some View {
    List {
      Section {
        Picker(
          String(localized: "leaderboard.period", defaultValue: "Period"),
          selection: $model.competitionPeriod
        ) {
          ForEach(CompetitionPeriod.allCases) { Text($0.title).tag($0) }
        }.pickerStyle(.segmented).disabled(
          actions.loadLeaderboard == nil && actions.loadLeaderboardPage == nil)
        NavigationLink(String(localized: "results.title", defaultValue: "Results")) {
          CompetitionResultsScreen(model: model, actions: actions)
        }
        HStack {
          Text(value.periodTitle).font(.subheadline).foregroundStyle(.secondary)
          Spacer()
          Button {
            model.present(.leaderboardInfo)
          } label: {
            Image(systemName: "info.circle")
          }.frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel(
              String(localized: "leaderboard.periodDetails", defaultValue: "Period details"))
        }
        let podium = Dictionary(
          grouping: value.entries.filter {
            (1...3).contains($0.rank) && !model.hiddenParticipantIDs.contains($0.id)
          }, by: \.rank)
        if !podium.isEmpty {
          HStack(alignment: .top, spacing: 16) {
            ForEach(podium.keys.sorted(), id: \.self) { rank in
              if let entries = podium[rank], let first = entries.first {
                VStack(spacing: 8) {
                  CrownedAvatar(entry: first, size: 48)
                  Text(first.displayName).font(.caption).lineLimit(2)
                  if entries.count > 1 {
                    Button("+\((entries.count - 1).formatted())") { model.present(.tiedRank(rank)) }
                      .font(.caption).frame(minWidth: 44, minHeight: 44)
                      .accessibilityLabel(
                        String(localized: "leaderboard.viewTies", defaultValue: "View tied places"))
                  }
                }.frame(maxWidth: .infinity)
              }
            }
          }.padding(.top, 16).listRowSeparator(.hidden)
        }
        if case .failed = model.competition {
          Button(String(localized: "action.retry", defaultValue: "Retry")) {
            Task { await model.requestLeaderboard(using: actions) }
          }
        }
      }
      Section {
        if value.entries.isEmpty {
          Text(String(localized: "leaderboard.empty", defaultValue: "No folds yet"))
            .foregroundStyle(.secondary)
        }
        ForEach(value.entries.filter { !model.hiddenParticipantIDs.contains($0.id) }) { entry in
          LeaderboardRow(entry: entry).contextMenu {
            ParticipantMenu(entry: entry, model: model, actions: actions)
          }
        }
        if value.nextCursor != nil, actions.loadLeaderboardPage != nil {
          if model.leaderboardLoadingMore {
            ProgressView().frame(maxWidth: .infinity)
          } else {
            Button {
              Task { await model.requestLeaderboard(using: actions, nextPage: true) }
            } label: {
              if model.leaderboardPageFailed {
                Text(String(localized: "action.retry", defaultValue: "Retry"))
              } else {
                Text(String(localized: "leaderboard.more", defaultValue: "More places"))
              }
            }
          }
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if let current = value.currentUser {
        VStack(spacing: 4) {
          HStack {
            LeaderboardRow(entry: current)
            Button {
              model.present(.competition(.liveShare))
            } label: {
              Image(systemName: "square.and.arrow.up")
            }
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel(String(localized: "results.share", defaultValue: "Share result"))
          }
          if value.population >= 20, let percentile = current.percentile ?? value.percentile {
            Text(
              String(
                localized: "results.percentile",
                defaultValue: "More folds than \(percentile)% of participants")
            )
            .font(.caption).foregroundStyle(.secondary)
          } else {
            Text(String(localized: "results.building", defaultValue: "Building a comparison"))
              .font(.caption).foregroundStyle(.secondary)
          }
          if value.pendingFolds > 0 {
            Text(
              String(
                localized: "leaderboard.pending", defaultValue: "\(value.pendingFolds) pending")
            )
            .font(.caption).foregroundStyle(.secondary)
          }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.bar)
      }
    }
    .overlay(alignment: .top) { if case .loading = model.competition { ProgressView().padding(8) } }
    .refreshable { await model.requestLeaderboard(using: actions) }
  }
}

private struct LeaderboardRow: View {
  let entry: LeaderboardEntry
  var body: some View {
    HStack(spacing: 12) {
      Text(entry.rank, format: .number).font(.subheadline.monospacedDigit()).foregroundStyle(
        .secondary
      ).frame(minWidth: 24, alignment: .trailing)
      CrownedAvatar(entry: entry, size: 36)
      Text(entry.displayName).fontWeight(entry.isCurrentUser ? .semibold : .regular).lineLimit(2)
      Spacer(minLength: 8)
      Text(entry.folds, format: .number).monospacedDigit()
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

private struct CrownedAvatar: View {
  let entry: LeaderboardEntry
  let size: CGFloat
  private var medal: (String, Color)? {
    switch entry.rank {
    case 1: (String(localized: "medal.gold", defaultValue: "Gold"), .yellow)
    case 2: (String(localized: "medal.silver", defaultValue: "Silver"), .gray)
    case 3: (String(localized: "medal.bronze", defaultValue: "Bronze"), .brown)
    default: nil
    }
  }
  var body: some View {
    ApprovedAvatarImage(data: entry.approvedAvatarData, url: entry.approvedAvatarURL)
      .frame(width: size, height: size)
      .clipShape(Circle())
      .overlay(alignment: .topTrailing) {
        if let medal {
          Image(systemName: "crown.fill").font(.caption).foregroundStyle(medal.1)
            .padding(2).background(.background, in: Circle()).offset(x: 4, y: -7)
        }
      }
      .accessibilityLabel(medal?.0 ?? String(localized: "profile.avatar", defaultValue: "Avatar"))
  }
}

private struct InformationSheet: View {
  let title: String
  let text: String
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      Text(text).padding(24).frame(maxWidth: 520)
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button(String(localized: "action.done", defaultValue: "Done")) { dismiss() }
          }
        }
    }.presentationDetents([.medium])
  }
}

struct NotificationSettingsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    Form {
      if model.notificationAuthorization == .denied {
        Section {
          Label(
            String(localized: "notifications.disabled", defaultValue: "Notifications off"),
            systemImage: "bell.slash")
          if let open = actions.openNotificationSettings {
            Button(
              String(localized: "notifications.openSettings", defaultValue: "Open Settings"),
              action: open)
          }
        }
      }
      Section {
        Toggle(
          String(localized: "notifications.daily", defaultValue: "Daily limit reached"),
          isOn: preference(\.dailyLimit)
        )
        .tint(.black)
        if model.notificationPreferences.dailyLimit {
          Stepper(value: dailyThreshold, in: 1...100_000, step: 10) {
            LabeledContent(
              String(localized: "settings.dailyLimit", defaultValue: "Daily limit"),
              value: model.preferences.dailyLimit.formatted())
          }
        }
        Picker(
          String(localized: "notifications.weekly", defaultValue: "Weekly result"),
          selection: preference(\.weeklyResult)
        ) {
          ForEach(ResultNotificationChoice.allCases) { Text($0.title).tag($0) }
        }.disabled(!model.competitionJoined)
        Picker(
          String(localized: "notifications.monthly", defaultValue: "Monthly result"),
          selection: preference(\.monthlyResult)
        ) {
          ForEach(ResultNotificationChoice.allCases) { Text($0.title).tag($0) }
        }.disabled(!model.competitionJoined)
        if !model.competitionJoined {
          Button(
            String(
              localized: "profile.signInForNotifications",
              defaultValue: "Join to enable result notifications")
          ) {
            model.selectedTab = .leaderboard
          }
        }
      }.disabled(actions.saveNotifications == nil || model.operation != nil)
    }
    .navigationTitle(String(localized: "notifications.title", defaultValue: "Notifications"))
    .navigationBarTitleDisplayMode(.inline)
  }
  private func preference<Value>(_ key: WritableKeyPath<NotificationPreferences, Value>) -> Binding<
    Value
  > {
    Binding(
      get: { model.notificationPreferences[keyPath: key] },
      set: { value in
        guard let save = actions.saveNotifications else { return }
        var next = model.notificationPreferences
        next[keyPath: key] = value
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            model.notificationPreferences = try await save(next)
          }
        }
      })
  }

  private var dailyThreshold: Binding<Int> {
    Binding(
      get: { model.preferences.dailyLimit },
      set: { value in
        var next = model.preferences
        next.dailyLimit = value
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await actions.savePreferences(next)
          }
        }
      })
  }
}

private struct HistoryRecoveryScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  let export: () -> Void
  let reset: () -> Void

  var body: some View {
    Form {
      Section {
        Text(
          String(
            localized: "recovery.explanation",
            defaultValue: "Some synced history couldn’t be verified."))
      }
      Section {
        if actions.export != nil, actions.exportURL != nil {
          Button(String(localized: "data.export", defaultValue: "Export"), action: export)
        }
        if actions.reset != nil {
          Button(
            String(localized: "data.reset", defaultValue: "Reset history"), role: .destructive,
            action: reset
          ).disabled(!model.canResetHistory)
        }
        Link(
          String(localized: "leaderboard.appeal", defaultValue: "Contact support"),
          destination: URL(string: "mailto:support@getfolding.app")!)
      }
    }
    .disabled(model.operation != nil)
    .navigationTitle(String(localized: "recovery.title", defaultValue: "History needs attention"))
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct TrackingPhoneScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var confirming = false

  var body: some View {
    Form {
      Section(String(localized: "phone.personalHistory", defaultValue: "Personal history")) {
        if let selection = model.trackingPhoneSelection {
          Label(
            selection.title,
            systemImage: selection == .thisPhone
              ? "iphone.gen3" : "iphone.gen3.radiowaves.left.and.right")
          if selection != .thisPhone || model.publicTrackingPhone == .anotherPhone,
            actions.useThisPhone != nil
          {
            Button(String(localized: "phone.useThis", defaultValue: "Use this iPhone")) {
              confirming = true
            }
            .disabled(model.operation != nil)
          }
        } else {
          ProgressView()
        }
      }
      if let selection = model.publicTrackingPhone {
        Section(String(localized: "tab.leaderboard", defaultValue: "Leaderboard")) {
          Label(selection.title, systemImage: "trophy")
        }
      }
    }
    .navigationTitle(String(localized: "phone.title", defaultValue: "Tracking phone"))
    .navigationBarTitleDisplayMode(.inline)
    .navigationDestination(isPresented: $confirming) {
      TrackingPhoneConfirmation(model: model, actions: actions)
    }
  }
}

private struct TrackingPhoneConfirmation: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    Form {
      Section {
        if model.publicTrackingPhone == .anotherPhone {
          Text(
            String(
              localized: "phone.publicTransferEffect",
              defaultValue:
                "Moves leaderboard tracking here. Later uploads from your other iPhone won’t count."
            ))
        }
        Text(
          String(
            localized: "phone.transferEffect",
            defaultValue: "Folds not yet received from other phones will appear only in exports."))
        Button(String(localized: "phone.useThis", defaultValue: "Use this iPhone")) {
          Task {
            await model.selectThisPhone(using: actions)
          }
        }
        .disabled(
          model.operation != nil || actions.useThisPhone == nil
            || (model.trackingPhoneSelection == .thisPhone
              && model.publicTrackingPhone != .anotherPhone)
        )
      }
    }
    .navigationTitle(String(localized: "phone.confirmTitle", defaultValue: "Use this iPhone?"))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button(String(localized: "action.cancel", defaultValue: "Cancel")) { dismiss() }
          .disabled(model.operation != nil)
      }
    }
    .onChange(of: model.operation) { _, operation in
      if operation == nil && model.trackingPhoneSelection == .thisPhone
        && model.publicTrackingPhone != .anotherPhone
      {
        dismiss()
      }
    }
    .onChange(of: model.trackingPhoneSelection) { _, selection in
      if selection == .thisPhone && model.publicTrackingPhone != .anotherPhone { dismiss() }
    }
  }
}

/// No file URL survives the Settings-to-share transition. Resolve the opaque ticket only
/// on the active share surface, allowing the service to recheck account/reset validity.
private struct ExportShareHost: View {
  let ticket: UUID
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var file: URL?
  @State private var finished = false

  var body: some View {
    Group {
      if model.sheet == .export(ticket), let file, !finished {
        ExportShareSheet(file: file) { error in
          if error != nil, !finished, model.sheet == .export(ticket) {
            model.error = String(
              localized: "error.tryAgain", defaultValue: "Something went wrong.")
          }
          Task { await finish(dismiss: true) }
        }
      } else {
        ProgressView(String(localized: "export.progress", defaultValue: "Preparing export"))
      }
    }
    .task(id: ticket) {
      do {
        guard let resolve = actions.exportURL else { throw ExportPresentationError.unavailable }
        let resolved = try await resolve(ticket)
        guard !Task.isCancelled, !finished, model.sheet == .export(ticket) else {
          await finish(dismiss: false)
          return
        }
        file = resolved
      } catch {
        if !Task.isCancelled, !finished, model.sheet == .export(ticket) {
          model.error = String(
            localized: "error.tryAgain", defaultValue: "Something went wrong.")
        }
        await finish(dismiss: true)
      }
    }
    .onDisappear { Task { await finish(dismiss: false) } }
  }

  private func finish(dismiss: Bool) async {
    guard !finished else { return }
    finished = true
    file = nil
    if dismiss, model.sheet == .export(ticket) { model.sheet = nil }
    await actions.exportFinished?(ticket)
  }
}

private enum ExportPresentationError: Error { case unavailable }

private struct ExportShareSheet: UIViewControllerRepresentable {
  let file: URL
  let completion: (Error?) -> Void
  func makeUIViewController(context: Context) -> UIActivityViewController {
    let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    controller.completionWithItemsHandler = { _, _, _, error in completion(error) }
    return controller
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Feedback belongs to the currently presented surface, including full-screen setup.
private struct FoldingFeedback: ViewModifier {
  @Bindable var model: FoldingPresentation
  let presentsAlert: Bool
  func body(content: Content) -> some View {
    content
      .overlay {
        if let operation = model.operation {
          ProgressView(operation)
            .padding(24)
            .background(
              .regularMaterial, in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius)
            )
            .accessibilityAddTraits(.updatesFrequently)
        }
      }
      .alert(
        String(localized: "error.title", defaultValue: "Unable to continue"),
        isPresented: Binding(
          get: { presentsAlert && model.error != nil },
          set: { if !$0 && presentsAlert { model.error = nil } })
      ) {
        Button(String(localized: "action.ok", defaultValue: "OK"), role: .cancel) {
          model.error = nil
        }
      } message: {
        Text(model.error ?? "")
      }
  }
}
