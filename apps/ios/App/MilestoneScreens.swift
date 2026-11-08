import SwiftUI

extension MilestoneBadge {
  var title: String {
    switch self {
    case .folds1: String(localized: "badge.folds1", defaultValue: "First Fold")
    case .folds100: String(localized: "badge.folds100", defaultValue: "Getting Into It")
    case .folds1000: String(localized: "badge.folds1000", defaultValue: "Four Figures")
    case .folds10000: String(localized: "badge.folds10000", defaultValue: "Well Used")
    case .days7: String(localized: "badge.days7", defaultValue: "Part of the Routine")
    case .days30: String(localized: "badge.days30", defaultValue: "Daily Companion")
    }
  }
  var requirement: String {
    switch self {
    case .folds1:
      String(
        localized: "badge.requirement.folds1", defaultValue: "Record your first competition fold.")
    case .folds100:
      String(localized: "badge.requirement.folds100", defaultValue: "Record 100 competition folds.")
    case .folds1000:
      String(
        localized: "badge.requirement.folds1000", defaultValue: "Record 1,000 competition folds.")
    case .folds10000:
      String(
        localized: "badge.requirement.folds10000", defaultValue: "Record 10,000 competition folds.")
    case .days7:
      String(
        localized: "badge.requirement.days7",
        defaultValue: "Record competition folds on 7 different days.")
    case .days30:
      String(
        localized: "badge.requirement.days30",
        defaultValue: "Record competition folds on 30 different days.")
    }
  }
}
extension MilestoneTrack {
  var title: String {
    switch self {
    case .folds: String(localized: "milestones.folds", defaultValue: "Folds")
    case .days: String(localized: "milestones.days", defaultValue: "Days used")
    }
  }
}

struct MilestoneBadgeArtwork: View {
  let badge: MilestoneBadge
  var size: CGFloat = 64
  var body: some View {
    Image("badge_" + badge.rawValue).resizable().renderingMode(.template)
      .scaledToFit().frame(width: size, height: size)
      .accessibilityLabel(badge.title)
  }
}

struct YourProfileScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    Group {
      if !model.competitionJoined {
        ContentUnavailableView(
          String(localized: "profile.unavailable", defaultValue: "Profile unavailable"),
          systemImage: "person.crop.circle")
      } else {
        List {
          Section {
            VStack(spacing: 12) {
              ApprovedAvatarImage(
                data: model.competitionProfile?.approvedAvatarData,
                url: model.competitionProfile?.approvedAvatarURL
              )
              .frame(width: 80, height: 80).clipShape(Circle()).accessibilityHidden(true)
              Text(model.competitionProfile?.nickname ?? "").font(.title2.bold())
              if let badge = visibleOwner?.featuredBadgeID {
                HStack {
                  MilestoneBadgeArtwork(badge: badge, size: 28).accessibilityHidden(true)
                  Text(badge.title)
                }
                .font(.subheadline)
              }
            }.frame(maxWidth: .infinity).padding(.vertical, 12)
          }
          if let owner = visibleOwner {
            Section {
              LabeledContent(
                String(localized: "milestones.total", defaultValue: "All-time folds"),
                value: owner.progress.folds.formatted())
            }
            Section(String(localized: "milestones.next", defaultValue: "Next milestones")) {
              NavigationLink {
                MilestonesScreen(model: model, actions: actions)
              } label: {
                MilestoneProgressRows(progress: owner.progress)
              }
            }
            Section {
              NavigationLink {
                MilestonesScreen(model: model, actions: actions)
              } label: {
                LabeledContent(
                  String(localized: "milestones.earned", defaultValue: "Earned badges"),
                  value: owner.grants.count.formatted())
              }
              if !owner.grants.isEmpty {
                EarnedBadgeGrid(
                  badges: Array(owner.grants.prefix(3).map(\.badgeID)), model: model,
                  actions: actions, owner: true)
              }
            }
          } else {
            Section { MilestoneLoadState(model: model, actions: actions) }
          }
          if model.milestonesCached {
            Text(
              String(localized: "milestones.cached", defaultValue: "Last synced progress")
            ).font(.footnote).foregroundStyle(.secondary)
          }
          Section {
            NavigationLink(String(localized: "profile.edit", defaultValue: "Edit Profile")) {
              CompetitionProfileScreen(model: model, actions: actions, joining: false)
            }
          }
        }.refreshable { await model.requestMilestones(using: actions, force: true) }
      }
    }
    .navigationTitle(String(localized: "profile.yours", defaultValue: "Your Profile"))
    .navigationBarTitleDisplayMode(.inline)
    .task { await model.requestMilestones(using: actions) }
  }
  private var visibleOwner: OwnerMilestones? {
    guard model.syncStatus?.resetPending != true, !model.entryDeletionPending else { return nil }
    return model.ownerMilestones
  }
}

struct MilestonesScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    List {
      if model.competitionJoined, model.syncStatus?.resetPending != true,
        !model.entryDeletionPending,
        let owner = model.ownerMilestones
      {
        Section(String(localized: "milestones.next", defaultValue: "Next milestones")) {
          MilestoneProgressRows(progress: owner.progress)
        }
        Section(String(localized: "milestones.earned", defaultValue: "Earned badges")) {
          if owner.grants.isEmpty {
            Text(
              String(
                localized: "milestones.first",
                defaultValue: "Your first recorded fold earns a badge.")
            )
            .foregroundStyle(.secondary)
          } else {
            EarnedBadgeGrid(
              badges: owner.grants.map(\.badgeID), model: model, actions: actions, owner: true)
          }
        }
        if model.milestonesCached {
          Text(
            String(localized: "milestones.cached", defaultValue: "Last synced progress")
          ).font(.footnote).foregroundStyle(.secondary)
        }
      } else {
        MilestoneLoadState(model: model, actions: actions)
      }
    }
    .navigationTitle(String(localized: "milestones.title", defaultValue: "Milestones"))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        NavigationLink {
          Text(
            String(
              localized: "milestones.help",
              defaultValue:
                "Milestones count verified folds since joining or your last reset. Days use UTC and don’t need to be consecutive."
            )
          )
          .padding().navigationTitle(
            String(localized: "milestones.title", defaultValue: "Milestones"))
        } label: {
          Image(systemName: "info.circle")
        }
        .accessibilityLabel(String(localized: "milestones.about", defaultValue: "About milestones"))
      }
    }
    .refreshable { await model.requestMilestones(using: actions, force: true) }
    .task { await model.requestMilestones(using: actions) }
  }
}

private struct MilestoneLoadState: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    if model.milestonesLoading {
      ProgressView()
    } else {
      VStack(alignment: .leading, spacing: 12) {
        Text(String(localized: "milestones.unavailable", defaultValue: "Progress unavailable"))
          .foregroundStyle(.secondary)
        Button(String(localized: "action.retry", defaultValue: "Retry")) {
          Task { await model.requestMilestones(using: actions, force: true) }
        }.disabled(
          !model.competitionJoined || model.syncStatus?.resetPending == true
            || model.entryDeletionPending)
      }
    }
  }
}

private struct MilestoneProgressRows: View {
  let progress: MilestoneProgress
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      ForEach(MilestoneTrack.allCases, id: \.rawValue) { track in
        if let next = progress.next.first(where: { $0.track == track }) {
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(track.title).fontWeight(.medium)
              Spacer(minLength: 8)
              Text("\(next.current.formatted()) / \(next.target.formatted())").monospacedDigit()
                .foregroundStyle(.secondary)
            }.accessibilityHidden(true)
            ProgressView(value: next.fraction)
              .accessibilityLabel(track.title)
              .accessibilityValue("\(next.current.formatted()) / \(next.target.formatted())")
          }
        } else {
          LabeledContent(track.title) {
            Image(systemName: "checkmark.circle.fill")
              .accessibilityLabel(
                String(localized: "milestones.complete", defaultValue: "All milestones earned"))
          }
        }
      }
    }.padding(.vertical, 8)
  }
}

private struct EarnedBadgeGrid: View {
  @Environment(\.dynamicTypeSize) private var typeSize
  let badges: [MilestoneBadge]
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  let owner: Bool
  @State private var selectedBadge: MilestoneBadge?
  var body: some View {
    LazyVGrid(
      columns: typeSize.isAccessibilitySize
        ? [GridItem(.flexible())] : [GridItem(.adaptive(minimum: 110))], spacing: 20
    ) {
      ForEach(badges) { badge in
        Button {
          selectedBadge = badge
        } label: {
          VStack(spacing: 8) {
            MilestoneBadgeArtwork(badge: badge).accessibilityHidden(true)
            Text(badge.title).font(.caption).multilineTextAlignment(.center).fixedSize(
              horizontal: false, vertical: true)
          }.frame(maxWidth: .infinity, minHeight: 100).contentShape(Rectangle())
        }.buttonStyle(.plain)
      }
    }.padding(.vertical, 8)
      .navigationDestination(item: $selectedBadge) { badge in
        MilestoneBadgeDetail(badge: badge, owner: owner, model: model, actions: actions)
      }
  }
}

struct MilestoneBadgeDetail: View {
  let badge: MilestoneBadge
  let owner: Bool
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    Form {
      Section {
        VStack(spacing: 20) {
          MilestoneBadgeArtwork(badge: badge, size: 128).accessibilityHidden(true)
          Text(badge.title).font(.title2.bold())
          Text(badge.requirement).foregroundStyle(.secondary)
        }.multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 20)
        if owner,
          let time = model.ownerMilestones?.grants.first(where: { $0.badgeID == badge })?.earnedAtMS
        {
          LabeledContent(String(localized: "milestones.earnedOn", defaultValue: "Earned")) {
            Text(
              Date(timeIntervalSince1970: Double(time) / 1000),
              format: Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: .gmt))
          }
        }
      }
      if owner, model.ownerMilestones?.grants.contains(where: { $0.badgeID == badge }) == true {
        Section {
          let selected = model.ownerMilestones?.featuredBadgeID == badge
          Button {
            Task { await model.featureMilestone(selected ? nil : badge, using: actions) }
          } label: {
            HStack {
              Text(
                selected
                  ? String(localized: "milestones.unfeature", defaultValue: "Remove from Profile")
                  : String(localized: "milestones.feature", defaultValue: "Feature on Profile"))
              Spacer()
              if model.milestonesSaving {
                ProgressView()
              } else if selected {
                Image(systemName: "checkmark")
              }
            }
          }.disabled(
            model.milestonesSaving || model.milestonesCached || actions.featureMilestone == nil)
          if model.milestonesFeatureFailed {
            Text(
              String(localized: "milestones.saveFailed", defaultValue: "Couldn’t save. Try again.")
            ).foregroundStyle(.secondary)
          }
        }
      }
      if owner, model.milestonesCached {
        Section {
          Text(String(localized: "milestones.cached", defaultValue: "Last synced progress"))
            .font(.footnote).foregroundStyle(.secondary)
          Button(String(localized: "action.retry", defaultValue: "Retry")) {
            Task { await model.requestMilestones(using: actions, force: true) }
          }.disabled(model.milestonesLoading)
        }
      }
    }.navigationTitle(badge.title).navigationBarTitleDisplayMode(.inline)
  }
}

struct ProfileDestinationScreen: View {
  let participantID: String
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    if participantID == model.competitionProfile?.id {
      YourProfileScreen(model: model, actions: actions)
    } else {
      ParticipantProfileScreen(participantID: participantID, model: model, actions: actions)
    }
  }
}

struct ParticipantProfileScreen: View {
  @Environment(\.scenePhase) private var phase
  let participantID: String
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var value: ParticipantProfileLoad?
  @State private var loadedContext: UUID?
  @State private var loading = false
  @State private var requestID = UUID()
  var body: some View {
    List {
      if model.competitionJoined, loadedContext == model.milestonesContext, let value {
        let profile = value.profile.profile
        Section {
          VStack(spacing: 12) {
            ApprovedAvatarImage(data: value.avatarData, url: nil).frame(width: 80, height: 80)
              .clipShape(Circle()).accessibilityHidden(true)
            Text(profile.nickname).font(.title2.bold())
            if let badge = profile.featuredBadgeID {
              HStack {
                MilestoneBadgeArtwork(badge: badge, size: 28).accessibilityHidden(true)
                Text(badge.title)
              }.font(.subheadline)
            }
          }.frame(maxWidth: .infinity).padding(.vertical, 12)
          LabeledContent(
            String(localized: "milestones.total", defaultValue: "All-time folds"),
            value: profile.folds.formatted())
        }
        if !profile.earnedBadges.isEmpty {
          Section(String(localized: "milestones.earned", defaultValue: "Earned badges")) {
            EarnedBadgeGrid(
              badges: profile.earnedBadges, model: model, actions: actions, owner: false)
          }
        }
      } else if loading {
        ProgressView()
      } else {
        ContentUnavailableView {
          Label(
            String(localized: "profile.unavailable", defaultValue: "Profile unavailable"),
            systemImage: "person.crop.circle")
        } actions: {
          Button(String(localized: "action.retry", defaultValue: "Retry")) {
            Task { await refresh() }
          }
        }
      }
    }
    .navigationTitle(String(localized: "profile.title", defaultValue: "Profile"))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if value != nil, model.competitionJoined, loadedContext == model.milestonesContext,
        let report = actions.reportParticipant
      {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            ForEach(ParticipantReportReason.allCases) { reason in
              Button(reason.title) {
                Task {
                  await model.command(
                    String(localized: "report.sending", defaultValue: "Sending report")
                  ) {
                    try await report(participantID, reason)
                  }
                }
              }
            }
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel(String(localized: "report.title", defaultValue: "Report"))
        }
      }
    }
    .refreshable { await refresh() }
    .task(id: "\(participantID)-\(model.milestonesContext)-\(phase)") {
      guard phase == .active else {
        value = nil
        return
      }
      while !Task.isCancelled {
        await refresh()
        do { try await Task.sleep(for: .seconds(30)) } catch { return }
      }
    }
  }
  private func refresh() async {
    guard model.competitionJoined, let load = actions.loadParticipantProfile else {
      value = nil
      return
    }
    let context = model.milestonesContext
    let request = UUID()
    requestID = request
    loading = true
    defer { if context == model.milestonesContext { loading = false } }
    do {
      let response = try await load(participantID)
      guard context == model.milestonesContext, request == requestID, !Task.isCancelled else {
        return
      }
      value = response
      loadedContext = context
    } catch { if request == requestID { value = nil } }
  }
}

struct MilestoneUnlockScreen: View {
  let badges: [MilestoneBadge]
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    NavigationStack {
      List {
        Section {
          EarnedBadgeGrid(badges: badges, model: model, actions: actions, owner: true)
        }
        Button(String(localized: "milestones.view", defaultValue: "View Badges")) {
          model.present(.competition(.milestones))
        }
      }
      .navigationTitle(String(localized: "milestones.unlocked", defaultValue: "Badges earned"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
        }
      }
    }
    .onAppear { model.didShowMilestoneUnlock(badges) }
  }
}
