import AuthenticationServices
import FoldingData
import FoldingDomain
import SwiftUI

struct LeaderboardScreen: View {
  @Environment(\.colorScheme) private var colorScheme
  @State private var selectedParticipantID: String?
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    Group {
      if model.competitionRemoval != nil {
        CompetitionRemovalScreen(model: model, actions: actions)
      } else if let visible = model.competition.previous {
        rankedList(visible)
      } else {
        switch model.competition {
        case .unavailable:
          ContentUnavailableView(
            String(localized: "leaderboard.unavailable", defaultValue: "Leaderboard unavailable"),
            systemImage: "trophy")
        case .notJoined:
          VStack(spacing: 24) {
            Image(systemName: "trophy").font(.largeTitle).foregroundStyle(.secondary)
            Text(
              model.competitionAuthenticationRequired
                ? String(localized: "leaderboard.signInAgain", defaultValue: "Sign in again")
                : String(localized: "leaderboard.joinTitle", defaultValue: "Join Folding")
            ).font(
              .title.bold())
            if model.competitionProfile != nil && !model.competitionAuthenticationRequired {
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
        case .loading, .failed:
          rankedList(nil)
        case .loaded(let value): rankedList(value)
        }
      }
    }
    .navigationDestination(
      isPresented: Binding(
        get: { selectedParticipantID != nil },
        set: { if !$0 { selectedParticipantID = nil } })
    ) {
      if let id = selectedParticipantID {
        ProfileDestinationScreen(participantID: id, model: model, actions: actions)
      }
    }
    .task(id: model.competitionPeriod) {
      switch model.competition {
      case .loaded, .failed, .loading: await model.requestLeaderboard(using: actions)
      default: break
      }
    }
  }

  private func rankedList(_ value: LeaderboardPresentation?) -> some View {
    List {
      Section {
        Picker(
          String(localized: "leaderboard.period", defaultValue: "Period"),
          selection: $model.competitionPeriod
        ) {
          ForEach(CompetitionPeriod.allCases) { Text($0.title).tag($0) }
        }.pickerStyle(.segmented).disabled(
          actions.loadLeaderboard == nil && actions.loadLeaderboardPage == nil)
        if let value {
          let podium = Dictionary(
            grouping: value.entries.filter {
              (1...3).contains($0.rank)
            }, by: \.rank)
          Group {
            HStack(alignment: .bottom, spacing: 16) {
              ForEach([2, 1, 3], id: \.self) { rank in
                if let entries = podium[rank], let first = entries.first {
                  VStack(spacing: 8) {
                    Button {
                      selectedParticipantID = first.id
                    } label: {
                      VStack(spacing: 8) {
                        CompetitionAvatar(entry: first, size: rank == 1 ? 64 : 48)
                        Text(first.displayName).font(.caption).lineLimit(2)
                      }
                    }.buttonStyle(.plain).disabled(first.isBlocked)
                  }.frame(maxWidth: .infinity)
                } else {
                  VStack(spacing: 8) {
                    Image(systemName: "person.fill")
                      .font(.title3).foregroundStyle(.tertiary)
                      .frame(width: rank == 1 ? 64 : 48, height: rank == 1 ? 64 : 48)
                      .overlay(
                        Circle().stroke(
                          .tertiary, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])))
                    Text("—").font(.caption).foregroundStyle(.tertiary)
                  }.frame(maxWidth: .infinity).accessibilityHidden(true)
                }
              }
            }.padding(.top, 16).listRowSeparator(.hidden)
          }
        } else if case .loading = model.competition {
          LeaderboardPodiumPlaceholder()
            .padding(.top, 16)
            .listRowSeparator(.hidden)
        }
        if case .failed = model.competition {
          Label(
            String(localized: "leaderboard.unavailable", defaultValue: "Leaderboard unavailable"),
            systemImage: "wifi.exclamationmark")
          Button(String(localized: "action.retry", defaultValue: "Retry")) {
            Task { await model.requestLeaderboard(using: actions) }
          }
        }
      }
      Section {
        if case .loading = model.competition {
          ProgressView()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .listRowSeparator(.hidden)
            .accessibilityLabel(String(localized: "action.refreshing", defaultValue: "Refreshing"))
        }
        if let value {
          if value.entries.isEmpty {
            Text(String(localized: "leaderboard.empty", defaultValue: "No folds yet"))
              .foregroundStyle(.secondary)
          }
          ForEach(value.entries) { entry in
            LeaderboardMemberLink(entry: entry, model: model, actions: actions)
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
    }
    .safeAreaInset(edge: .bottom) {
      if let current = value?.currentUser {
        VStack(spacing: 4) {
          HStack {
            NavigationLink {
              YourProfileScreen(model: model, actions: actions)
            } label: {
              LeaderboardRow(
                entry: current, showAdminBotMarker: model.revealAdminBotMarker(for: current.id))
            }.buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.bar)
      }
    }
    .refreshable { await model.requestLeaderboard(using: actions) }
  }
}

struct LeaderboardRow: View {
  let entry: LeaderboardEntry
  var showAdminBotMarker = false
  var body: some View {
    HStack(spacing: 12) {
      Text(entry.rank, format: .number).font(.subheadline.monospacedDigit()).foregroundStyle(
        .secondary
      ).frame(minWidth: 24, alignment: .trailing)
      CompetitionAvatar(entry: entry, size: 36)
      HStack(spacing: 6) {
        Text(entry.displayName).fontWeight(entry.isCurrentUser ? .semibold : .regular).lineLimit(2)
        if showAdminBotMarker {
          Circle().fill(.secondary).frame(width: 6, height: 6)
            .accessibilityLabel("Simulated player")
        }
      }
      Spacer(minLength: 8)
      Text(entry.folds, format: .number).monospacedDigit()
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

private struct CompetitionAvatar: View {
  let entry: LeaderboardEntry
  let size: CGFloat
  private var medal: CompetitionMedal? {
    switch entry.rank {
    case 1: .gold
    case 2: .silver
    case 3: .bronze
    default: nil
    }
  }
  var body: some View {
    ApprovedAvatarImage(data: entry.approvedAvatarData, url: entry.approvedAvatarURL)
      .frame(width: size, height: size)
      .clipShape(Circle())
      .overlay {
        if let medal {
          PodiumRing(medal: medal, size: size)
        }
      }
      .accessibilityLabel(
        medal?.title ?? String(localized: "profile.avatar", defaultValue: "Avatar"))
  }
}
