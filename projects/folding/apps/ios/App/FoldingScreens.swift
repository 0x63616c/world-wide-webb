import FoldingData
import FoldingDomain
import SwiftUI

struct FoldingRootView: View {
  @Environment(\.scenePhase) private var milestoneScenePhase
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
            String(localized: "tab.analytics", defaultValue: "Analytics"), systemImage: "chart.bar",
            value: .today
          ) {
            NavigationStack {
              TodayScreen(model: model, actions: actions)
                .navigationTitle(String(localized: "tab.analytics", defaultValue: "Analytics"))
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
                    ToolbarItem(placement: .topBarTrailing) {
                      Button {
                        model.present(.competition(.profile))
                      } label: {
                        ApprovedAvatarImage(
                          data: model.competitionProfile?.approvedAvatarData,
                          url: model.competitionProfile?.approvedAvatarURL
                        )
                        .frame(width: 36, height: 36).clipShape(Circle())
                        .contentShape(Circle())
                      }
                      .buttonStyle(.plain)
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
              .id(model.competitionProfile?.id)
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
    .sheet(
      item: ordinarySheet,
      onDismiss: {
        model.didDismissSheet()
        Task { await model.dismissMilestoneUnlock(using: actions) }
      }
    ) { sheet in
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
    .onChange(of: milestoneScenePhase, initial: true) { _, phase in
      model.milestonesForeground = phase == .active
    }
    .task(id: "\(model.milestonesContext)-\(model.competitionJoined)-\(milestoneScenePhase)") {
      if milestoneScenePhase == .active { await model.requestMilestones(using: actions) }
    }
    .onChange(of: model.milestonePresentationTrigger) { _, _ in model.presentMilestoneUnlockIfSafe()
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
    case .milestoneUnlock(let badges):
      MilestoneUnlockScreen(badges: badges, model: model, actions: actions)
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
    case .patterns: PatternsScreen(model: model, actions: actions)
    case .export(let ticket):
      ExportShareHost(ticket: ticket, model: model, actions: actions)
    case .setup: EmptyView()
    }
  }

}

struct SummaryCard<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    content
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(20)
      .frame(minHeight: 108, alignment: .leading)
      .background(
        FoldingSurface.card,
        in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius))
  }
}

struct MetricRow: View {
  let title: String
  let value: String
  @ScaledMetric(relativeTo: .largeTitle) private var valueSize: CGFloat = 44

  init(title: String, value: String) {
    self.title = title
    self.value = value
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title).font(.subheadline).foregroundStyle(.secondary)
      Spacer(minLength: 8)
      Text(value)
        .font(.system(size: valueSize, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .frame(minHeight: 72, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
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
