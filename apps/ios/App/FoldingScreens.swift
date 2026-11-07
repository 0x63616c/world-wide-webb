import AuthenticationServices
import Charts
import FoldingData
import FoldingDomain
import SwiftUI
import UIKit

struct FoldingRootView: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var historyPath: [HistoryRoute] = []
  @State private var activeExport: URL?

  var body: some View {
    TabView(selection: $model.selectedTab) {
      Tab(
        String(localized: "tab.today", defaultValue: "Today"), systemImage: "chart.bar",
        value: .today
      ) {
        NavigationStack {
          TodayScreen(model: model, actions: actions)
            .navigationTitle(String(localized: "tab.today", defaultValue: "Today"))
            .toolbar { settingsButton }
        }
      }
      Tab(
        String(localized: "tab.history", defaultValue: "History"), systemImage: "clock",
        value: .history
      ) {
        NavigationStack(path: $historyPath) {
          HistoryScreen(model: model, actions: actions)
            .navigationTitle(String(localized: "tab.history", defaultValue: "History"))
            .toolbar { settingsButton }
            .navigationDestination(for: HistoryRoute.self) { route in
              switch route {
              case .session(let session): SessionScreen(session: session)
              }
            }
        }
      }
      Tab(
        String(localized: "tab.leaderboard", defaultValue: "Leaderboard"), systemImage: "trophy",
        value: .leaderboard
      ) {
        NavigationStack {
          LeaderboardScreen(model: model, actions: actions)
            .navigationTitle(String(localized: "tab.leaderboard", defaultValue: "Leaderboard"))
            .toolbar { settingsButton }
        }
      }
    }
    .tabViewStyle(.tabBarOnly)
    .tabBarMinimizeBehavior(.never)
    .tint(model.preferences.accent.color)
    .environment(\.timeZone, TimeZone(identifier: model.preferences.homeTimezone) ?? .current)
    .preferredColorScheme(model.preferences.appearance.scheme)
    .sheet(item: ordinarySheet, onDismiss: dismissed) { sheet in
      sheetContent(sheet)
        .preferredColorScheme(model.preferences.appearance.scheme)
        .tint(model.preferences.accent.color)
        .modifier(FoldingFeedback(model: model, presentsAlert: true))
    }
    .fullScreenCover(isPresented: setupPresented, onDismiss: model.didDismissSheet) {
      SetupScreen(model: model, actions: actions)
        .preferredColorScheme(model.preferences.appearance.scheme)
        .tint(model.preferences.accent.color)
        .modifier(FoldingFeedback(model: model, presentsAlert: true))
    }
    .modifier(FoldingFeedback(model: model, presentsAlert: model.sheet == nil))
  }

  private var settingsButton: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Button {
        model.present(.settings)
      } label: {
        Image(systemName: "gearshape")
      }
      .accessibilityLabel(String(localized: "settings.title", defaultValue: "Settings"))
    }
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
    case .editSummary: SummaryEditor(model: model, actions: actions)
    case .travelInfo:
      InformationSheet(
        title: String(localized: "metric.equivalentTravel", defaultValue: "Equivalent travel"),
        text: String(
          localized: "travel.explanation",
          defaultValue:
            "A playful full-swing equivalent based on your recorded folds, not measured movement."))
    case .leaderboardInfo:
      let periodTitle = model.competition.previous?.periodTitle ?? ""
      InformationSheet(
        title: String(localized: "leaderboard.period", defaultValue: "Period"),
        text: String(
          localized: "leaderboard.periodTimezone",
          defaultValue: "\(periodTitle) · UTC"))
    case .tiedRank(let rank):
      NavigationStack {
        List(model.competition.previous?.entries.filter { $0.rank == rank } ?? []) { entry in
          LeaderboardRow(entry: entry)
        }
        .navigationTitle(String(localized: "leaderboard.tiedRank", defaultValue: "Tied places"))
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
          }
        }
      }
    case .export(let file):
      ExportShareSheet(file: file) { model.sheet = nil }
        .onAppear { activeExport = file }
    case .setup: EmptyView()
    }
  }

  private func dismissed() {
    if let file = activeExport {
      activeExport = nil
      Task { await actions.exportFinished?(file) }
    }
    model.didDismissSheet()
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
      VStack(alignment: .leading, spacing: 24) {
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
        } else if let status = model.status {
          Label(status, systemImage: "arrow.triangle.2.circlepath").font(.subheadline)
            .foregroundStyle(.secondary)
        }
        if let today {
          VStack(alignment: .leading, spacing: 4) {
            Text(today.folds, format: .number).font(
              .system(.largeTitle, design: .rounded, weight: .bold)
            ).monospacedDigit()
            Text(String(localized: "metric.folds", defaultValue: "Folds")).foregroundStyle(
              .secondary)
          }
          .accessibilityElement(children: .combine)
          ForEach(model.preferences.metrics) { metric in metricView(metric, today: today) }
          Button(String(localized: "today.editSummary", defaultValue: "Edit Summary")) {
            model.present(.editSummary)
          }
          .font(.subheadline)
        } else if let error = model.personalFailure {
          ContentUnavailableView(
            String(localized: "tracking.unavailable", defaultValue: "Tracking unavailable"),
            systemImage: "exclamationmark.icloud", description: Text(error))
        } else {
          ProgressView().frame(maxWidth: .infinity).padding(.vertical, 48)
        }
      }
      .frame(maxWidth: 720, alignment: .leading)
      .padding(16)
      .frame(maxWidth: .infinity)
    }
    .refreshable {
      await model.command(String(localized: "action.refreshing", defaultValue: "Refreshing")) {
        try await actions.refresh()
      }
    }
  }

  private var weekdayFormat: Date.FormatStyle {
    var format = Date.FormatStyle().weekday(.abbreviated)
    format.timeZone = TimeZone(identifier: model.preferences.homeTimezone) ?? .current
    return format
  }

  @ViewBuilder private func metricView(_ metric: SummaryMetric, today: PersonalDailySummary)
    -> some View
  {
    switch metric {
    case .timeUnfolded:
      MetricRow(title: metric.title, value: foldingDuration(today.completeDurationMS))
      if let snapshot = model.analytics {
        let running = RunningDurationPresentation(snapshot: snapshot, day: today)
        if running.isRunning {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            let durationMS = running.durationMS(at: context.date)
            Label(foldingDuration(durationMS), systemImage: "timer")
              .font(.subheadline).foregroundStyle(.secondary)
              .monospacedDigit()
              .accessibilityLabel(
                String(
                  localized: "session.runningDuration",
                  defaultValue: "Running, \(foldingDuration(durationMS))"))
          }
        }
      }
    case .trend:
      VStack(alignment: .leading, spacing: 12) {
        Text(metric.title).font(.headline)
        if let snapshot = model.analytics {
          Chart(snapshot.days, id: \.startMS) { day in
            BarMark(
              x: .value(
                String(localized: "chart.date", defaultValue: "Date"),
                Date(timeIntervalSince1970: Double(day.startMS) / 1000)),
              y: .value(String(localized: "metric.folds", defaultValue: "Folds"), day.folds)
            )
            .accessibilityLabel(day.date)
            .accessibilityValue(day.folds.formatted())
          }
          .chartXAxis {
            AxisMarks(values: .stride(by: .day)) { _ in
              AxisValueLabel(format: weekdayFormat)
            }
          }
          .chartXScale(range: .plotDimension(padding: 16))
          .frame(height: 160)
          .accessibilityLabel(metric.title)
        }
      }
    case .opens: MetricRow(title: metric.title, value: today.opens.formatted())
    case .closes: MetricRow(title: metric.title, value: today.closes.formatted())
    case .cycles: MetricRow(title: metric.title, value: today.cycles.formatted())
    case .lifetimeFolds:
      MetricRow(title: metric.title, value: model.analytics?.lifetime.folds.formatted() ?? "—")
    case .equivalentTravel:
      HStack {
        MetricRow(
          title: metric.title,
          value: Measurement(value: today.equivalentMetres, unit: UnitLength.meters).formatted(
            .measurement(width: .abbreviated, usage: .asProvided)))
        Button {
          model.present(.travelInfo)
        } label: {
          Image(systemName: "info.circle")
        }.frame(minWidth: 44, minHeight: 44)
          .accessibilityLabel(
            String(localized: "travel.about", defaultValue: "About equivalent travel"))
      }
    }
  }
}

private struct MetricRow: View {
  let title: String
  let value: String
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title).font(.subheadline).foregroundStyle(.secondary)
      Text(value).font(.title2.weight(.semibold)).monospacedDigit()
    }.accessibilityElement(children: .combine)
  }
}

private struct HistoryScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var selectedDate: Date?

  var body: some View {
    List {
      Section {
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
            }.frame(minWidth: 44, minHeight: 44)
              .accessibilityLabel(
                String(localized: "history.previous", defaultValue: "Previous period")
              )
              .disabled(actions.loadHistory == nil || model.historyPeriod == .all)
            Text(history.title).font(.headline).frame(maxWidth: .infinity)
            Button {
              model.historyOffset += 1
            } label: {
              Image(systemName: "chevron.right")
            }.frame(minWidth: 44, minHeight: 44)
              .accessibilityLabel(String(localized: "history.next", defaultValue: "Next period"))
              .disabled(
                !history.canGoNext || actions.loadHistory == nil || model.historyPeriod == .all)
          }.listRowSeparator(.hidden)
          MetricRow(
            title: String(localized: "metric.folds", defaultValue: "Folds"),
            value: history.folds.formatted()
          ).listRowSeparator(.hidden)
          if !history.bins.isEmpty {
            Chart(history.bins) { bin in
              BarMark(
                x: .value(String(localized: "chart.date", defaultValue: "Date"), bin.start),
                y: .value(String(localized: "metric.folds", defaultValue: "Folds"), bin.folds)
              )
              .accessibilityLabel(bin.label).accessibilityValue(bin.folds.formatted())
            }
            .chartXScale(range: .plotDimension(padding: 16))
            .chartXSelection(value: $selectedDate)
            .frame(height: 180)
            .listRowSeparator(.hidden)
            if let selectedDate,
              let bin = history.bins.first(where: {
                $0.start <= selectedDate && selectedDate < $0.end
              })
            {
              LabeledContent(bin.label, value: bin.folds.formatted())
            }
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
      if let history = model.history {
        Section(String(localized: "history.days", defaultValue: "Activity")) {
          ForEach(history.bins) { bin in LabeledContent(bin.label, value: bin.folds.formatted()) }
        }
        Section(String(localized: "history.sessions", defaultValue: "Sessions")) {
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
          }
        }
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
}

private struct SessionScreen: View {
  let session: SessionPresentation
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
    .navigationTitle(String(localized: "history.session", defaultValue: "Session"))
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct SettingsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var resetConfirmation = false
  @State private var exportChoices = false

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
          Picker(
            String(localized: "settings.accent", defaultValue: "Accent"),
            selection: preference(\.accent)
          ) {
            ForEach(FoldingAccent.allCases) { accent in
              Label {
                Text(accent.title)
              } icon: {
                Image(systemName: "circle.fill").foregroundStyle(accent.color)
              }.tag(accent)
            }
          }
        }
        Section(String(localized: "tab.today", defaultValue: "Today")) {
          Button(String(localized: "today.editSummary", defaultValue: "Edit Summary")) {
            model.present(.editSummary)
          }
        }
        Section(String(localized: "settings.tracking", defaultValue: "Tracking")) {
          LabeledContent(
            String(localized: "settings.setup", defaultValue: "Setup"),
            value: model.needsSetup
              ? String(localized: "settings.setupRequired", defaultValue: "Not complete")
              : String(localized: "settings.setupComplete", defaultValue: "Tested"))
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
          NavigationLink(String(localized: "settings.homeTimezone", defaultValue: "Home timezone"))
          {
            TimezonePicker(model: model, actions: actions)
          }
          Stepper(value: preference(\.dailyLimit), in: 1...100_000, step: 10) {
            LabeledContent(
              String(localized: "settings.dailyLimit", defaultValue: "Daily limit"),
              value: model.preferences.dailyLimit.formatted())
          }
        }
        Section(String(localized: "settings.data", defaultValue: "Data")) {
          if actions.export != nil {
            Button(String(localized: "data.export", defaultValue: "Export")) {
              exportChoices = true
            }
          }
          if actions.reset != nil {
            Button(
              String(localized: "data.reset", defaultValue: "Reset history"), role: .destructive
            ) { resetConfirmation = true }
          }
        }
        Section(String(localized: "settings.support", defaultValue: "Support")) {
          Link(
            String(localized: "support.contact", defaultValue: "Contact"),
            destination: URL(string: "mailto:support@getfolding.app")!)
          Link(
            String(localized: "support.privacy", defaultValue: "Privacy"),
            destination: URL(string: "https://getfolding.app/privacy")!)
          LabeledContent(
            String(localized: "settings.version", defaultValue: "Version"),
            value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
        }
      }
      .disabled(model.operation != nil)
      .navigationTitle(String(localized: "settings.title", defaultValue: "Settings"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
        }
      }
      .confirmationDialog(
        String(localized: "data.exportFormat", defaultValue: "Export format"),
        isPresented: $exportChoices, titleVisibility: .visible
      ) {
        Button("JSON") { export(.json) }
        Button("CSV") { export(.csv) }
        Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
      }
      .alert(
        String(localized: "reset.title", defaultValue: "Reset history?"),
        isPresented: $resetConfirmation
      ) {
        Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
        Button(
          String(localized: "reset.confirm", defaultValue: "Reset History"), role: .destructive
        ) {
          Task {
            await model.command(
              String(localized: "reset.progress", defaultValue: "Resetting history")
            ) { try await actions.reset?() }
          }
        }
      } message: {
        Text(
          String(
            localized: "reset.message",
            defaultValue: "Deletes your history, leaderboard scores, and medals."))
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
        var next = model.preferences
        next[keyPath: key] = value
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await actions.savePreferences(next)
            model.preferences = next
          }
        }
      })
  }

  private func export(_ format: ExportChoice) {
    guard let export = actions.export else { return }
    Task {
      await model.command(String(localized: "export.progress", defaultValue: "Preparing export")) {
        let file = try await export(format)
        model.present(.export(file))
      }
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
          Label(String(localized: "metric.folds", defaultValue: "Folds"), systemImage: "checkmark")
            .foregroundStyle(.secondary)
        }
        Section {
          ForEach(ordered) { metric in
            Toggle(
              metric.title,
              isOn: Binding(
                get: { model.preferences.metrics.contains(metric) },
                set: { enabled in
                  var next = model.preferences
                  next.metrics = ordered.filter {
                    $0 == metric ? enabled : next.metrics.contains($0)
                  }
                  save(next)
                }))
          }.onMove { source, destination in
            ordered.move(fromOffsets: source, toOffset: destination)
            var next = model.preferences
            next.metrics = ordered.filter { next.metrics.contains($0) }
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
          model.preferences.metrics
          + SummaryMetric.allCases.filter { !model.preferences.metrics.contains($0) }
      }
    }
  }
  private func save(_ next: FoldingPreferences) {
    Task {
      await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
        try await actions.savePreferences(next)
        model.preferences = next
      }
    }
  }
}

private struct TimezonePicker: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var search = ""
  @Environment(\.dismiss) private var dismiss
  private var zones: [String] {
    TimeZone.knownTimeZoneIdentifiers.filter {
      search.isEmpty || $0.localizedCaseInsensitiveContains(search)
    }
  }
  var body: some View {
    List(zones, id: \.self) { zone in
      Button {
        var next = model.preferences
        next.homeTimezone = zone
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await actions.savePreferences(next)
            model.preferences = next
            dismiss()
          }
        }
      } label: {
        HStack {
          Text(zone.replacingOccurrences(of: "_", with: " "))
          Spacer()
          if zone == model.preferences.homeTimezone { Image(systemName: "checkmark") }
        }
      }
      .foregroundStyle(.primary)
    }
    .searchable(text: $search)
    .navigationTitle(String(localized: "settings.homeTimezone", defaultValue: "Home timezone"))
  }
}

private struct SetupScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
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

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          FoldIllustration(open: !closing, success: passed)
            .frame(height: 180)
            .accessibilityHidden(true)
          Text(title).font(.largeTitle.bold()).multilineTextAlignment(.center)
          if let sentence {
            Text(sentence).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
          }
          if step.isWaiting {
            ProgressView().accessibilityLabel(title)
            if let expires = model.setup?.expiresAtMS {
              Text(Date(timeIntervalSince1970: Double(expires) / 1000), style: .timer)
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                .accessibilityLabel(
                  String(localized: "setup.timeRemaining", defaultValue: "Time remaining"))
            }
          }
          primaryButton
          if step == .openingInstructions || step == .closingInstructions {
            if let open = actions.openShortcuts {
              Button(
                String(localized: "setup.openShortcuts", defaultValue: "Open Shortcuts"),
                action: open)
            }
            if let instructions {
              DisclosureGroup(String(localized: "action.help", defaultValue: "Help")) {
                Text(instructions).frame(maxWidth: .infinity, alignment: .leading)
              }
              .font(.subheadline)
            }
          }
          if step == .openingRetry || step == .closingRetry, let open = actions.openShortcuts {
            Button(String(localized: "setup.checkSetup", defaultValue: "Check setup"), action: open)
          }
        }
        .frame(maxWidth: 520)
        .padding(24)
        .frame(maxWidth: .infinity)
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: step)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button(
            step == .complete
              ? String(localized: "action.done", defaultValue: "Done")
              : String(localized: "setup.notNow", defaultValue: "Not now")
          ) { dismissSetup() }
          .disabled(model.operation != nil)
        }
      }
    }
    .interactiveDismissDisabled()
    .onChange(of: step) { _, next in
      if next == .openingPassed || next == .closingPassed {
        AccessibilityNotification.Announcement(
          String(localized: "setup.testPassed", defaultValue: "Test passed")
        ).post()
      }
    }
  }

  private var title: String {
    switch step {
    case .welcome: String(localized: "setup.welcome", defaultValue: "Every fold counts")
    case .openingInstructions:
      String(localized: "setup.openingAutomation", defaultValue: "Track opening")
    case .closingInstructions:
      String(localized: "setup.closingAutomation", defaultValue: "Track closing")
    case .openingReady, .closingReady: String(localized: "setup.ready", defaultValue: "Try it out")
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
    case .openingInstructions, .closingInstructions:
      instructions == nil
        ? String(
          localized: "setup.guideUnavailable",
          defaultValue: "Setup instructions aren't available for this version yet.")
        : String(localized: "setup.configure", defaultValue: "Add the automation in Shortcuts.")
    case .openingReady, .closingReady:
      String(localized: "setup.testDetail", defaultValue: "Start the test before moving your Duo.")
    case .complete:
      String(localized: "setup.completeDetail", defaultValue: "Your folds are ready to track.")
    default: nil
    }
  }

  @ViewBuilder private var primaryButton: some View {
    if step.isWaiting {
      Button(String(localized: "action.cancel", defaultValue: "Cancel")) { perform(.dismiss) }
        .buttonStyle(.bordered)
    } else if step == .complete {
      Button(String(localized: "action.done", defaultValue: "Done")) { dismissSetup() }.buttonStyle(
        .borderedProminent)
    } else {
      Button(buttonTitle) { perform(buttonAction) }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(
          model.operation != nil
            || ((step == .openingInstructions || step == .closingInstructions)
              && instructions == nil)
        )
    }
  }

  private var buttonAction: SetupAction {
    switch step {
    case .openingReady, .closingReady: .test
    case .openingRetry, .closingRetry: .retry
    default: .next
    }
  }
  private var buttonTitle: String {
    switch step {
    case .openingReady, .closingReady: String(localized: "setup.test", defaultValue: "Test")
    case .openingRetry, .closingRetry: String(localized: "action.retry", defaultValue: "Retry")
    default: String(localized: "action.continue", defaultValue: "Continue")
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
        model.sheet = nil
      }
    }
  }
}

private struct FoldIllustration: View {
  let open: Bool
  let success: Bool
  @State private var expanded = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(spacing: 3) {
      RoundedRectangle(cornerRadius: 12).fill(.quaternary).overlay(
        RoundedRectangle(cornerRadius: 12).stroke(.secondary, lineWidth: 2))
      RoundedRectangle(cornerRadius: 12).fill(.quaternary).overlay(
        RoundedRectangle(cornerRadius: 12).stroke(.secondary, lineWidth: 2)
      )
      .rotation3DEffect(.degrees(expanded ? 0 : -70), axis: (x: 0, y: 1, z: 0), anchor: .leading)
    }
    .frame(width: 170, height: 160)
    .overlay {
      if success {
        Image(systemName: "checkmark.circle.fill").font(.largeTitle).symbolRenderingMode(.palette)
          .foregroundStyle(.white, .green).background(.background, in: Circle())
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
      switch model.competition {
      case .unavailable:
        ContentUnavailableView(
          String(localized: "leaderboard.unavailable", defaultValue: "Leaderboard unavailable"),
          systemImage: "trophy")
      case .notJoined:
        VStack(spacing: 24) {
          Image(systemName: "trophy").font(.largeTitle).foregroundStyle(.secondary)
          Text(String(localized: "leaderboard.joinTitle", defaultValue: "Find your place")).font(
            .title.bold())
          Text(
            String(
              localized: "leaderboard.joinDetail",
              defaultValue: "Compare folds. Keep tracking personal.")
          ).foregroundStyle(.secondary)
          if let request = actions.appleRequest, let completion = actions.appleCompletion {
            SignInWithAppleButton(.signIn, onRequest: request, onCompletion: completion)
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
              String(localized: "leaderboard.unavailable", defaultValue: "Leaderboard unavailable"),
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
        }.pickerStyle(.segmented).disabled(actions.loadLeaderboard == nil)
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
          grouping: value.entries.filter { (1...3).contains($0.rank) }, by: \.rank)
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
        ForEach(value.entries) { entry in LeaderboardRow(entry: entry) }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if let current = value.currentUser {
        VStack(spacing: 4) {
          LeaderboardRow(entry: current)
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
    AsyncImage(url: entry.approvedAvatarURL) { phase in
      if let image = phase.image {
        image.resizable().scaledToFill()
      } else {
        Image(systemName: "person.crop.circle.fill").resizable().scaledToFit().foregroundStyle(
          .secondary)
      }
    }
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

private struct ExportShareSheet: UIViewControllerRepresentable {
  let file: URL
  let completion: () -> Void
  func makeUIViewController(context: Context) -> UIActivityViewController {
    let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    controller.completionWithItemsHandler = { _, _, _, _ in completion() }
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
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
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
