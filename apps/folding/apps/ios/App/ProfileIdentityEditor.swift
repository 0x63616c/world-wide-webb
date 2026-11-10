import ImageIO
import PhotosUI
import SwiftUI
import UIKit

struct InlineProfileIdentity: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var photoItem: PhotosPickerItem?
  @State private var photo: UIImage?
  @State private var zoom = 1.0
  @State private var editingPhoto = false
  @State private var editingName = false
  @State private var nickname = ""

  var body: some View {
    VStack(spacing: 12) {
      PhotosPicker(selection: $photoItem, matching: .images) {
        ApprovedAvatarImage(
          data: model.competitionProfile?.approvedAvatarData,
          url: model.competitionProfile?.approvedAvatarURL
        )
        .frame(width: 80, height: 80).clipShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(String(localized: "profile.choosePhoto", defaultValue: "Choose photo"))
      .disabled(actions.uploadAvatar == nil || model.operation != nil)
      .contextMenu {
        if let remove = actions.removeAvatar,
          model.competitionProfile?.avatarState != AvatarState.none
        {
          Button(
            String(localized: "profile.removePhoto", defaultValue: "Remove photo"),
            role: .destructive
          ) {
            Task {
              await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
                try await remove()
              }
            }
          }
        }
      }
      Button {
        nickname = model.competitionProfile?.nickname ?? ""
        editingName = true
      } label: {
        Text(model.competitionProfile?.nickname ?? "").font(.title2.bold())
      }.buttonStyle(.plain).disabled(actions.saveNickname == nil || model.operation != nil)
    }
    .frame(maxWidth: .infinity).padding(.vertical, 12)
    .alert(
      String(localized: "profile.nickname", defaultValue: "Display name"), isPresented: $editingName
    ) {
      TextField(
        String(localized: "profile.nickname", defaultValue: "Display name"), text: $nickname
      )
      .textInputAutocapitalization(.never).autocorrectionDisabled()
      Button(String(localized: "profile.save", defaultValue: "Save")) {
        let clean = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let save = actions.saveNickname else { return }
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            do { model.competitionProfile = try await save(clean) } catch CompetitionUIError
              .chooseAnotherName
            {
              model.error = String(
                localized: "profile.chooseName", defaultValue: "Choose another name")
            }
          }
        }
      }.disabled(
        nickname.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || nickname.count > 20)
      Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
    }
    .onChange(of: model.competitionProfile?.id) { _, _ in
      editingName = false
      editingPhoto = false
      photo = nil
      photoItem = nil
    }
    .task(id: photoItem) {
      guard let item = photoItem else { return }
      let participant = model.competitionProfile?.id
      do {
        let image = try await AvatarImagePreparation.load(item)
        guard !Task.isCancelled, photoItem == item, model.competitionProfile?.id == participant
        else { return }
        photo = image
        zoom = 1
        editingPhoto = true
      } catch {
        guard !Task.isCancelled else { return }
        model.error = String(localized: "profile.photoFailed", defaultValue: "Choose another photo")
      }
    }
    .sheet(
      isPresented: $editingPhoto,
      onDismiss: clearPhoto
    ) {
      NavigationStack {
        VStack(spacing: 24) {
          if let photo {
            Image(uiImage: photo).resizable().scaledToFill().scaleEffect(zoom)
              .frame(width: 240, height: 240).clipShape(Circle())
            Slider(value: $zoom, in: 1...3) {
              Text(String(localized: "profile.crop", defaultValue: "Crop"))
            }
            Button(String(localized: "profile.save", defaultValue: "Save")) {
              guard let upload = actions.uploadAvatar,
                let data = AvatarImagePreparation.jpeg(photo, zoom: zoom)
              else { return }
              Task {
                await model.command(
                  String(localized: "profile.uploading", defaultValue: "Uploading photo")
                ) {
                  _ = try await upload(data)
                  editingPhoto = false
                }
              }
            }.buttonStyle(.borderedProminent).foregroundStyle(FoldingTint.onTint)
          }
        }.padding(24)
          .navigationTitle(String(localized: "profile.choosePhoto", defaultValue: "Choose photo"))
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button(String(localized: "action.cancel", defaultValue: "Cancel")) {
                editingPhoto = false
              }
            }
          }
          .disabled(model.operation != nil)
          .overlay { if model.operation != nil { ProgressView() } }
          .alert(
            String(localized: "error.title", defaultValue: "Unable to continue"),
            isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
          ) {
            Button(String(localized: "action.done", defaultValue: "Done")) { model.error = nil }
          } message: {
            Text(model.error ?? "")
          }
      }.presentationDetents([.medium, .large]).interactiveDismissDisabled(model.operation != nil)
    }
  }
  private func clearPhoto() {
    photo = nil
    photoItem = nil
  }

}

struct ProfileAccountActions: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var confirming = false
  var body: some View {
    Button(
      String(localized: "profile.delete", defaultValue: "Delete competition account"),
      role: .destructive
    ) { confirming = true }
    .disabled(actions.deleteCompetitionAccount == nil || model.operation != nil)
    .confirmationDialog(
      String(localized: "profile.delete", defaultValue: "Delete competition account"),
      isPresented: $confirming, titleVisibility: .visible
    ) {
      Button(
        String(localized: "profile.delete", defaultValue: "Delete competition account"),
        role: .destructive
      ) {
        Task {
          await model.command(
            String(localized: "profile.removing", defaultValue: "Removing competition data")
          ) {
            guard let remove = actions.deleteCompetitionAccount else { return }
            try await remove()
            try await actions.refresh()
          }
        }
      }
      Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
    } message: {
      Text(
        String(
          localized: "profile.removalEffect",
          defaultValue:
            "Deletes your competition account, profile, photo, scores and results. Your private fold history stays."
        ))
    }
  }
}

enum AvatarImagePreparation {
  static func load(_ item: PhotosPickerItem) async throws -> UIImage {
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
    return UIImage(cgImage: image)
  }
  @MainActor static func jpeg(_ photo: UIImage, zoom: Double) -> Data? {
    let side: CGFloat = 512
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image {
      _ in
      UIColor.systemBackground.setFill()
      UIRectFill(CGRect(x: 0, y: 0, width: side, height: side))
      let factor = max(side / photo.size.width, side / photo.size.height) * zoom
      let size = CGSize(width: photo.size.width * factor, height: photo.size.height * factor)
      photo.draw(
        in: CGRect(
          x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width,
          height: size.height))
    }.jpegData(compressionQuality: 0.85)
  }
}
