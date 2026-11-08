import AuthenticationServices
import CoreTransferable
import ImageIO
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct CompetitionSheetScreen: View {
  @Environment(\.colorScheme) private var colorScheme
  let screen: CompetitionSheet
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    NavigationStack {
      Group {
        switch screen {
        case .join: CompetitionProfileScreen(model: model, actions: actions, joining: true)
        case .profile: CompetitionProfileScreen(model: model, actions: actions, joining: false)
        case .results: CompetitionResultsScreen(model: model, actions: actions)
        case .liveShare: LiveCompetitionShareScreen(model: model)
        }
      }
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          if screen == .join && !model.competitionJoined {
            Button(String(localized: "action.cancel", defaultValue: "Cancel")) { model.sheet = nil }
              .disabled(model.operation != nil)
          } else {
            Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
              .disabled(model.operation != nil)
          }
        }
      }
    }
    .presentationBackground(colorScheme == .dark ? Color.black : Color.white)
    .interactiveDismissDisabled(model.operation != nil)
  }
}

protocol CompetitionJoinFailure: Error {
  var joinMessage: String { get }
}

struct CompetitionProfileScreen: View {
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var colorScheme
  @State private var profileRefreshFailed = false
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  let joining: Bool
  @State private var hasJoined = false
  private var creating: Bool { joining && !hasJoined }
  @State private var nickname = ""
  @State private var rejectedName = false
  @State private var photoItem: PhotosPickerItem?
  @State private var photo: UIImage?
  @State private var zoom = 1.0
  @State private var photoFailure = false
  @State private var photoLoading = false
  @State private var avatarState: AvatarState?
  @State private var confirmRemoval = false
  var body: some View {
    Group {
      if creating {
        joinContent
      } else {
        Form {
          Section {
            avatarPicker
            if photo != nil {
              Slider(value: $zoom, in: 1...3) {
                Text(String(localized: "profile.crop", defaultValue: "Crop"))
              }
              if !creating {
                Button(String(localized: "profile.upload", defaultValue: "Upload photo")) {
                  uploadPhoto()
                }
                .disabled(actions.uploadAvatar == nil)
              }
            }
            if photoLoading { ProgressView() }
            if photoFailure {
              Text(
                hasJoined
                  ? String(
                    localized: "profile.joinedPhotoFailed",
                    defaultValue: "You're in. Photo didn't upload.")
                  : String(localized: "profile.photoFailed", defaultValue: "Choose another photo")
              )
              .foregroundStyle(.secondary)
            }
            if avatarState == .rejected || model.competitionProfile?.avatarState == .rejected {
              Text(String(localized: "profile.photoFailed", defaultValue: "Choose another photo"))
            }
            if model.competitionProfile?.avatarState != AvatarState.none,
              let remove = actions.removeAvatar
            {
              Button(
                String(localized: "profile.removePhoto", defaultValue: "Remove photo"),
                role: .destructive
              ) {
                Task {
                  await model.command(String(localized: "settings.saving", defaultValue: "Saving"))
                  {
                    try await remove()
                    photo = nil
                    avatarState = AvatarState.none
                    try await actions.refresh()
                  }
                }
              }
            }
          }.listRowBackground(
            colorScheme == .dark ? Color.black : Color(uiColor: .systemBackground))
          Section {
            TextField(
              String(localized: "profile.nickname", defaultValue: "Display name"), text: $nickname
            )
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .onChange(of: nickname) { _, value in
              rejectedName = false
              model.joinNickname = value
            }
            if rejectedName {
              Text(String(localized: "profile.chooseName", defaultValue: "Choose another name"))
                .foregroundStyle(.red)
            }
            if profileRefreshFailed {
              Button(String(localized: "action.retry", defaultValue: "Retry")) {
                Task { await refreshProfile() }
              }
            }
            Button(
              creating
                ? String(localized: "profile.join", defaultValue: "Join")
                : String(localized: "profile.save", defaultValue: "Save")
            ) { saveName() }
            .buttonStyle(.borderedProminent)
            .foregroundStyle(FoldingTint.onTint)
            .frame(maxWidth: .infinity)
            .disabled(
              nickname.trimmingCharacters(in: .whitespacesAndNewlines).count < 3
                || nickname.count > 20
                || (creating ? actions.joinCompetition == nil : actions.saveNickname == nil))
          }.listRowBackground(
            colorScheme == .dark ? Color.black : Color(uiColor: .systemBackground))
          if !creating {
            Section {
              Button(
                String(localized: "profile.delete", defaultValue: "Delete competition account"),
                role: .destructive
              ) {
                confirmRemoval = true
              }.disabled(actions.deleteCompetitionAccount == nil)
            }.listRowBackground(
              colorScheme == .dark ? Color.black : Color(uiColor: .systemBackground))
          }
        }
        .listRowBackground(colorScheme == .dark ? Color.black : Color(uiColor: .systemBackground))
      }
    }
    .scrollContentBackground(.hidden)
    .background(colorScheme == .dark ? Color.black : Color(uiColor: .systemBackground))
    .environment(\.defaultMinListRowHeight, 48)
    .disabled(model.operation != nil)
    .navigationTitle(
      joining
        ? String(localized: "profile.joinTitle", defaultValue: "Join Folding")
        : String(localized: "profile.title", defaultValue: "Profile")
    )
    .navigationBarTitleDisplayMode(.inline)
    .task {
      nickname = joining ? model.joinNickname : (model.competitionProfile?.nickname ?? "")
    }
    .task(id: scenePhase) {
      guard !creating, scenePhase == .active else { return }
      await refreshProfile()
    }
    .onChange(of: model.competitionProfile?.avatarState) { _, state in
      avatarState = state
      if state == .approved {
        photo = nil
        photoItem = nil
      }
    }
    .task(id: photoItem) { await loadPhoto() }
    .confirmationDialog(
      String(localized: "profile.delete", defaultValue: "Delete competition account"),
      isPresented: $confirmRemoval, titleVisibility: .visible
    ) {
      Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
      Button(
        String(localized: "profile.delete", defaultValue: "Delete competition account"),
        role: .destructive
      ) {
        Task {
          await model.command(
            String(localized: "profile.removing", defaultValue: "Removing competition data")
          ) {
            guard let action = actions.deleteCompetitionAccount else { return }
            try await action()
            try await actions.refresh()
          }
        }
      }
    } message: {
      Text(
        String(
          localized: "profile.removalEffect",
          defaultValue: "Removes public scores and results."))
    }
  }

  private var joinContent: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(spacing: 20) {
          avatarPicker
          if photo != nil {
            Slider(value: $zoom, in: 1...3) {
              Text(String(localized: "profile.crop", defaultValue: "Crop"))
            }
          }
          if photoLoading { ProgressView() }
          if photoFailure {
            Text(String(localized: "profile.photoFailed", defaultValue: "Choose another photo"))
              .foregroundStyle(.secondary)
          }
          VStack(alignment: .leading, spacing: 8) {
            TextField(
              String(localized: "profile.nickname", defaultValue: "Display name"), text: $nickname
            )
            .textContentType(.name)
            .textInputAutocapitalization(.words)
            .padding(16)
            .background(
              Color(uiColor: .secondarySystemGroupedBackground),
              in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius)
            )
            .onChange(of: nickname) { _, value in
              rejectedName = false
              model.joinNickname = value
            }
          }
          if rejectedName {
            Text(String(localized: "profile.chooseName", defaultValue: "Choose another name"))
              .foregroundStyle(.red)
          }
          Button {
            saveName()
          } label: {
            Text(String(localized: "profile.join", defaultValue: "Join"))
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .foregroundStyle(FoldingTint.onTint)
          .controlSize(.large)
          .frame(maxWidth: .infinity)
          .disabled(
            nickname.trimmingCharacters(in: .whitespacesAndNewlines).count < 3
              || nickname.count > 20 || actions.joinCompetition == nil)
        }
        .frame(maxWidth: 380)
        .frame(minHeight: geometry.size.height, alignment: .center)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
      }
    }
    .background(colorScheme == .dark ? Color.black : Color.white)
  }

  private var avatarPicker: some View {
    PhotosPicker(selection: $photoItem, matching: .images) {
      VStack(spacing: 8) {
        avatarPreview
          .frame(width: creating ? 104 : 128, height: creating ? 104 : 128)
          .clipShape(Circle())
          .overlay(alignment: .bottomTrailing) {
            Image(systemName: "camera.fill")
              .font(.caption.weight(.bold))
              .foregroundStyle(FoldingTint.onTint)
              .padding(9)
              .background(.tint, in: Circle())
          }
      }
      .frame(maxWidth: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(actions.uploadAvatar == nil || photoLoading)
    .accessibilityLabel(String(localized: "profile.choosePhoto", defaultValue: "Choose photo"))
  }
  private func refreshProfile() async {
    guard let refresh = actions.refreshCompetitionProfile else { return }
    do {
      let profile = try await refresh()
      guard !Task.isCancelled else { return }
      model.competitionProfile = profile
      avatarState = profile.avatarState
      profileRefreshFailed = false
    } catch is CancellationError {} catch { profileRefreshFailed = true }
  }

  @ViewBuilder private var avatarPreview: some View {
    if let photo {
      Image(uiImage: photo).resizable().scaledToFill().scaleEffect(zoom)
    } else if creating, model.competitionProfile?.approvedAvatarData == nil,
      model.competitionProfile?.approvedAvatarURL == nil
    {
      Group {
        if let first = nickname.first {
          Text(String(first).uppercased())
            .font(.system(size: 54, weight: .semibold, design: .rounded))
        } else {
          Image(systemName: "person.fill")
            .font(.system(size: 48, weight: .medium))
        }
      }
      .foregroundStyle(FoldingTint.onTint)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(FoldingTint.color)
    } else {
      ApprovedAvatarImage(
        data: model.competitionProfile?.approvedAvatarData,
        url: model.competitionProfile?.approvedAvatarURL)
    }
  }

  private func saveName() {
    Task {
      await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
        do {
          let clean = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
          if creating {
            guard let join = actions.joinCompetition else { return }
            try await join(clean)
            hasJoined = true
            if let data = preparedAvatar(), let upload = actions.uploadAvatar {
              do { avatarState = try await upload(data) } catch {
                photoFailure = true
                return
              }
            }
            model.sheet = nil
          } else if let save = actions.saveNickname {
            model.competitionProfile = try await save(clean)
          }
        } catch CompetitionUIError.chooseAnotherName { rejectedName = true } catch let error
          as any CompetitionJoinFailure
        {
          model.error = error.joinMessage
        }
      }
    }
  }
  private func loadPhoto() async {
    guard let item = photoItem else { return }
    photoLoading = true
    photoFailure = false
    defer { if photoItem == item { photoLoading = false } }
    do {
      guard let asset = try await item.loadTransferable(type: BoundedAvatarImport.self),
        let source = CGImageSourceCreateWithData(
          asset.data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
        let image = CGImageSourceCreateThumbnailAtIndex(
          source, 0,
          [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 1024,
          ] as CFDictionary)
      else { throw CocoaError(.fileReadCorruptFile) }
      guard !Task.isCancelled else { return }
      photo = UIImage(cgImage: image)
      zoom = 1
    } catch { if !Task.isCancelled { photoFailure = true } }
  }
  private func preparedAvatar() -> Data? {
    guard let photo else { return nil }
    let side: CGFloat = 512
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let output = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
      .image { _ in
        UIColor.systemBackground.setFill()
        UIRectFill(CGRect(x: 0, y: 0, width: side, height: side))
        let factor = max(side / photo.size.width, side / photo.size.height) * zoom
        let size = CGSize(width: photo.size.width * factor, height: photo.size.height * factor)
        photo.draw(
          in: CGRect(
            x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width,
            height: size.height))
      }
    return output.jpegData(compressionQuality: 0.85)
  }
  private func uploadPhoto() {
    guard let data = preparedAvatar(), let upload = actions.uploadAvatar else { return }
    Task {
      await model.command(String(localized: "profile.uploading", defaultValue: "Uploading photo")) {
        avatarState = try await upload(data)
      }
    }
  }
}

struct CompetitionResultsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var focusedResult: CompetitionResult?
  var body: some View {
    List {
      Picker(
        String(localized: "leaderboard.period", defaultValue: "Period"),
        selection: $model.resultsPeriod
      ) {
        ForEach(CompetitionPeriod.allCases) { Text($0.title).tag($0) }
      }.pickerStyle(.segmented)
      if model.resultsPeriod == .all {
        if let entry = model.allTimeResult?.currentUser {
          LabeledContent(
            String(localized: "metric.folds", defaultValue: "Folds"), value: entry.folds.formatted()
          )
          LabeledContent(
            String(localized: "results.rank", defaultValue: "Rank"), value: entry.rank.formatted())
        } else if !model.resultsLoading {
          Text(String(localized: "results.empty", defaultValue: "No results yet"))
        }
        if model.resultsLoading { ProgressView() }
        if model.resultsFailed {
          Button(String(localized: "action.retry", defaultValue: "Retry")) {
            Task { await model.requestResults(using: actions) }
          }
        }
      } else {
        if actions.loadResults == nil {
          Text(String(localized: "results.unavailable", defaultValue: "Results unavailable"))
        } else if model.results.isEmpty && !model.resultsLoading && !model.resultsFailed {
          Text(String(localized: "results.empty", defaultValue: "No results yet"))
        }
        ForEach(model.results) { result in
          NavigationLink {
            CompetitionResultScreen(result: result, actions: actions)
          } label: {
            HStack {
              VStack(alignment: .leading) {
                Text(result.start, format: .dateTime.month(.abbreviated).day().year())
                Text(result.folds, format: .number).foregroundStyle(.secondary)
              }
              Spacer()
              if let medal = result.medal { Text(medal.title) }
              Text(result.rank, format: .number).monospacedDigit()
            }
          }
        }
        if model.resultsLoading { ProgressView() }
        if model.resultsFailed {
          Text(String(localized: "results.unavailable", defaultValue: "Results unavailable"))
            .foregroundStyle(.secondary)
        } else if model.resultsCursor != nil {
          Button(String(localized: "results.more", defaultValue: "More results")) {
            Task { await model.requestResults(using: actions, nextPage: true) }
          }.disabled(model.resultsLoading)
        }
      }
    }
    .navigationTitle(String(localized: "results.title", defaultValue: "Results"))
    .task(id: model.resultsPeriod) { await model.requestResults(using: actions) }
    .navigationDestination(item: $focusedResult) {
      CompetitionResultScreen(result: $0, actions: actions)
    }
    .task(id: model.requestedResultID) {
      guard let id = model.requestedResultID, let load = actions.loadResultShare else { return }
      do {
        let share = try await load(id)
        guard !Task.isCancelled, model.requestedResultID == id, share.result.id == id else {
          return
        }
        focusedResult = share.result
        model.requestedResultID = nil
      } catch {
        guard !Task.isCancelled, model.requestedResultID == id else { return }
        model.requestedResultID = nil
        model.error = String(
          localized: "error.tryAgain", defaultValue: "Something went wrong.")
      }
    }
    .refreshable { await model.requestResults(using: actions) }
  }
}

private struct CompetitionResultScreen: View {
  let result: CompetitionResult
  let actions: FoldingActions
  @State private var share: CompetitionShare?
  @State private var shareFailed = false
  @State private var shareLoading = false
  var body: some View {
    Form {
      Section {
        LabeledContent(
          String(localized: "results.place", defaultValue: "Place"), value: result.rank.formatted())
        LabeledContent(
          String(localized: "metric.folds", defaultValue: "Folds"), value: result.folds.formatted())
        LabeledContent(
          String(localized: "results.participants", defaultValue: "Participants"),
          value: result.population.formatted())
        if let medal = result.medal {
          Text(medal.title)
        }
        Text(result.start..<result.end, format: .interval.day().month().year())
          .foregroundStyle(.secondary)
      }
      if let load = actions.loadResultShare {
        Section {
          if let share {
            ResultSharePreview(share: share)
          } else {
            Button(String(localized: "results.share", defaultValue: "Share result")) {
              Task {
                shareLoading = true
                shareFailed = false
                defer { shareLoading = false }
                do {
                  let value = try await load(result.id)
                  guard !Task.isCancelled, value.result.id == result.id,
                    value.result.version == result.version
                  else {
                    shareFailed = true
                    return
                  }
                  share = value
                } catch { if !Task.isCancelled { shareFailed = true } }
              }
            }.disabled(shareLoading)
          }
          if shareLoading { ProgressView() }
          if shareFailed {
            Text(
              String(localized: "error.tryAgain", defaultValue: "Something went wrong."))
          }
        }
      }
    }
    .navigationTitle(String(localized: "results.title", defaultValue: "Results"))
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct ResultSharePreview: View {
  let share: CompetitionShare
  @State private var image: UIImage?
  var body: some View {
    VStack(spacing: 16) {
      ResultShareCard(share: share)
      if let image {
        ShareLink(
          item: Image(uiImage: image),
          preview: SharePreview("Folding", image: Image(uiImage: image))
        ) {
          Label(
            String(localized: "results.share", defaultValue: "Share result"),
            systemImage: "square.and.arrow.up")
        }
      }
    }.task {
      let renderer = ImageRenderer(
        content: ResultShareCard(share: share).frame(width: 360).padding(24).background(.background)
      )
      renderer.scale = 3
      image = renderer.uiImage
    }
  }
}
private struct ResultShareCard: View {
  let share: CompetitionShare
  var body: some View {
    VStack(spacing: 12) {
      Text("Folding").font(.title.bold())
      ZStack(alignment: .top) {
        Group {
          if let data = share.approvedAvatarData, data.count <= 512 * 1024,
            let image = UIImage(data: data)
          {
            Image(uiImage: image).resizable().scaledToFill()
          } else {
            Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.secondary)
          }
        }.frame(width: 76, height: 76).clipShape(Circle())
      }.padding(.top, 12)
      Text(share.nickname).font(.headline)
      LabeledContent(
        String(localized: "results.place", defaultValue: "Place"),
        value: share.result.rank.formatted())
      LabeledContent(
        String(localized: "metric.folds", defaultValue: "Folds"),
        value: share.result.folds.formatted())
      Text(share.result.start..<share.result.end, format: .interval.day().month().year()).font(
        .caption)
    }.padding().foregroundStyle(.primary)
  }
}

struct ParticipantMenu: View {
  let entry: LeaderboardEntry
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    if !entry.isCurrentUser {
      if let report = actions.reportParticipant {
        Menu(String(localized: "report.title", defaultValue: "Report")) {
          ForEach(ParticipantReportReason.allCases) { reason in
            Button(reason.title) {
              Task {
                await model.command(
                  String(localized: "report.sending", defaultValue: "Sending report")
                ) {
                  try await report(entry.id, reason)
                }
              }
            }
          }
        }
      }
    }
  }
}

private struct BoundedAvatarImport: Transferable, Sendable {
  let data: Data
  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(importedContentType: .image) { received in
      let maximum = 10 * 1024 * 1024
      let values = try received.file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
      guard values.isRegularFile == true, let size = values.fileSize, size > 0, size <= maximum
      else { throw CocoaError(.fileReadTooLarge) }
      let handle = try FileHandle(forReadingFrom: received.file)
      defer { try? handle.close() }
      guard let data = try handle.read(upToCount: maximum + 1), data.count <= maximum
      else { throw CocoaError(.fileReadTooLarge) }
      return Self(data: data)
    }
  }
}

struct NativeAppleSignInButton: UIViewRepresentable {
  let dark: Bool
  let action: () -> Void
  func makeCoordinator() -> Coordinator { Coordinator(action: action) }
  func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
    let button = ASAuthorizationAppleIDButton(type: .continue, style: dark ? .white : .black)
    button.addTarget(
      context.coordinator, action: #selector(Coordinator.activate), for: .touchUpInside)
    return button
  }
  func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
    context.coordinator.action = action
    uiView.isEnabled = context.environment.isEnabled
  }
  @MainActor final class Coordinator: NSObject {
    var action: () -> Void
    init(action: @escaping () -> Void) { self.action = action }
    @objc func activate() { action() }
  }
}

struct CompetitionRemovalScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    ContentUnavailableView {
      Label(
        String(localized: "profile.removalPending", defaultValue: "Removal pending"),
        systemImage: "clock")
    } actions: {
      Button(String(localized: "action.retry", defaultValue: "Retry")) {
        Task {
          await model.command(
            String(localized: "profile.removing", defaultValue: "Removing competition data")
          ) { try await actions.refresh() }
        }
      }.disabled(model.operation != nil)
    }
  }
}

private struct LiveCompetitionShareScreen: View {
  @Bindable var model: FoldingPresentation
  @State private var image: UIImage?
  var body: some View {
    ScrollView {
      if let board = model.competition.previous, let entry = board.currentUser {
        VStack(spacing: 20) {
          card(board, entry)
          if let image {
            ShareLink(
              item: Image(uiImage: image),
              preview: SharePreview("Folding", image: Image(uiImage: image))
            ) {
              Label(
                String(localized: "results.share", defaultValue: "Share result"),
                systemImage: "square.and.arrow.up")
            }
          }
        }.padding()
          .task(id: board.updatedAt) {
            let renderer = ImageRenderer(
              content: card(board, entry).frame(width: 360).padding(24).background(.background))
            renderer.scale = 3
            image = renderer.uiImage
          }
      }
    }.navigationTitle(String(localized: "results.share", defaultValue: "Share result"))
      .navigationBarTitleDisplayMode(.inline)
  }
  private func card(_ board: LeaderboardPresentation, _ entry: LeaderboardEntry) -> some View {
    VStack(spacing: 12) {
      Text("Folding").font(.title.bold())
      ApprovedAvatarImage(data: entry.approvedAvatarData, url: nil)
        .frame(width: 76, height: 76).clipShape(Circle())
      Text(entry.displayName).font(.headline)
      Text(board.periodTitle).font(.subheadline)
      LabeledContent(
        String(localized: "results.place", defaultValue: "Place"), value: entry.rank.formatted())
      LabeledContent(
        String(localized: "metric.folds", defaultValue: "Folds"), value: entry.folds.formatted())
      Label(String(localized: "results.live", defaultValue: "Live placement"), systemImage: "clock")
        .font(.caption)
      Text(board.updatedAt, format: .dateTime.month().day().hour().minute()).font(.caption)
    }.padding()
  }
}

struct ApprovedAvatarImage: View {
  let data: Data?
  let url: URL?
  var body: some View {
    Group {
      if let data, data.count <= 512 * 1024, let image = UIImage(data: data) {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Image(systemName: "person.crop.circle.fill").resizable().scaledToFit().foregroundStyle(
          .secondary)
      }
    }
  }
}
