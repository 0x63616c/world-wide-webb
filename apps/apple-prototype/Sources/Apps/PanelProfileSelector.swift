import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

private struct PanelProfile: Codable, Identifiable {
    var id = UUID()
    let name: String
    let photo: Data
}

private struct PanelProfiles: Codable {
    var users: [PanelProfile] = []
    var selectedID: UUID?

    var selected: PanelProfile? { users.first { $0.id == selectedID } }
}

struct PanelProfileSelector: View {
    @AppStorage("panel.profiles") private var storage = Data()
    @AppStorage("panel.profilePhoto") private var legacyPhoto = Data()
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showingProfiles = false
    @State private var addingUser = false

    private var profiles: PanelProfiles {
        (try? JSONDecoder().decode(PanelProfiles.self, from: storage)) ?? PanelProfiles()
    }

    var body: some View {
        let profiles = profiles
        Button {
            addingUser = false
            showingProfiles = true
        } label: {
            ProfileAvatar(photo: profiles.selected?.photo ?? launcherPhoto, side: 48)
                .foregroundStyle(.white.opacity(0.85))
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Profiles")
        .accessibilityValue(profiles.selected?.name ?? "")
        .accessibilityIdentifier("home-profile")
        .popover(isPresented: $showingProfiles, arrowEdge: .top) {
            Group {
                if addingUser {
                    AddPanelProfile(cancel: { addingUser = false }, save: add)
                } else {
                    profileList(profiles)
                }
            }
            .frame(width: 284)
            .padding(20)
            .presentationCompactAdaptation(.sheet)
        }
    }

    private var launcherPhoto: Data {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["PANEL_PROFILE_PREVIEW"],
           let data = try? Data(contentsOf: URL(fileURLWithPath: path)) { return data }
        #endif
        return legacyPhoto
    }

    private func profileList(_ profiles: PanelProfiles) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Profiles").font(.title3.bold()).accessibilityAddTraits(.isHeader)
                Spacer()
                if sizeClass == .compact {
                    Button("Close", systemImage: "xmark", role: .close) { showingProfiles = false }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                }
            }
            if profiles.users.isEmpty {
                Text("Add a name and photo to create a profile.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ViewThatFits(in: .vertical) {
                    profileRows(profiles).fixedSize(horizontal: false, vertical: true)
                    ScrollView { profileRows(profiles) }
                }
                .frame(maxHeight: 244)
            }
            Divider()
            Button {
                addingUser = true
            } label: {
                Label("Add User", systemImage: "plus")
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile-add")
        }
    }

    private func profileRows(_ profiles: PanelProfiles) -> some View {
        LazyVStack(spacing: 4) {
            ForEach(profiles.users) { user in
                let selected = user.id == profiles.selectedID
                Button {
                    var updated = self.profiles
                    updated.selectedID = user.id
                    persist(updated)
                    showingProfiles = false
                } label: {
                    HStack(spacing: 12) {
                        ProfileAvatar(photo: user.photo, side: 36)
                        Text(user.name).lineLimit(2)
                        Spacer(minLength: 4)
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.subheadline.weight(.semibold))
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(minHeight: 48)
                    .background(selected ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(.clear),
                                in: .rect(cornerRadius: 14))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private func add(_ profile: PanelProfile) {
        var updated = profiles
        updated.users.append(profile)
        updated.selectedID = profile.id
        persist(updated)
        addingUser = false
    }

    private func persist(_ profiles: PanelProfiles) {
        if let data = try? JSONEncoder().encode(profiles) { storage = data }
    }
}

private struct AddPanelProfile: View {
    let cancel: () -> Void
    let save: (PanelProfile) -> Void
    @State private var name = ""
    @State private var selection: PhotosPickerItem?
    @State private var imported: (item: PhotosPickerItem, photo: Data?)?

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var photo: Data? { imported?.item == selection ? imported?.photo : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add User").font(.title3.bold()).accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 6) {
                Text("Name").font(.subheadline.weight(.medium))
                TextField("Name", text: $name, prompt: Text("Enter a name"))
                    .textContentType(.name)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 12))
                    .accessibilityIdentifier("profile-name")
            }

            PhotosPicker(selection: $selection, matching: .images) {
                HStack(spacing: 12) {
                    ProfileAvatar(photo: photo ?? Data(), side: 48)
                    Text(photo == nil ? "Choose Photo" : "Change Photo")
                        .font(.body.weight(.medium))
                    Spacer(minLength: 4)
                    if selection != nil && imported?.item != selection {
                        ProgressView().controlSize(.small).accessibilityLabel("Loading photo")
                    } else {
                        Image(systemName: "photo.on.rectangle").foregroundStyle(.secondary)
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile-photo")
            if let imported, imported.item == selection, imported.photo == nil {
                Text("Couldn’t load this photo. Choose another.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Divider()
            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    Button("Cancel", role: .cancel, action: cancel)
                        .buttonStyle(.glass)
                    Spacer()
                    Button("Add", role: .confirm) {
                        guard let photo, !trimmedName.isEmpty else { return }
                        save(PanelProfile(name: trimmedName, photo: photo))
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(trimmedName.isEmpty || photo == nil)
                    .accessibilityIdentifier("profile-save")
                }
                .controlSize(.large)
            }
        }
        .task(id: selection) {
            guard let selection else { return }
            let data = try? await selection.loadTransferable(type: Data.self)
            guard !Task.isCancelled else { return }
            imported = (selection, data.flatMap(ProfileAvatar.compressedPhoto))
        }
    }
}

private struct ProfileAvatar: View {
    let photo: Data
    let side: CGFloat
    @State private var thumbnail: CGImage?

    var body: some View {
        Group {
            if let thumbnail {
                Image(decorative: thumbnail, scale: 1).resizable().scaledToFill()
            } else {
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: side * 0.875))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: side, height: side)
        .clipShape(.circle)
        .accessibilityHidden(true)
        .task(id: photo) { thumbnail = Self.decodeThumbnail(photo) }
    }

    static func compressedPhoto(_ data: Data) -> Data? {
        guard let image = decodeThumbnail(data) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.86] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }

    private static func decodeThumbnail(_ data: Data) -> CGImage? {
        guard !data.isEmpty, let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 256
        ] as CFDictionary)
    }
}
