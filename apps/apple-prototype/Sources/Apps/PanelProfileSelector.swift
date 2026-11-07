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

struct PanelProfileSelector: ViewModifier {
    let isAvailable: Bool
    let inset: CGFloat

    @AppStorage("panel.profiles") private var storage = Data()
    @AppStorage("panel.profilePhoto") private var legacyPhoto = Data()
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingProfiles = false
    @State private var addingUser = false

    private var profiles: PanelProfiles {
        (try? JSONDecoder().decode(PanelProfiles.self, from: storage)) ?? PanelProfiles()
    }

    func body(content: Content) -> some View {
        let profiles = profiles
        let isOpen = isAvailable && showingProfiles
        content
            .allowsHitTesting(!isOpen)
            .accessibilityHidden(isOpen)
            .overlay {
                if isOpen {
                    LinearGradient(
                        colors: [.black.opacity(0.52), .black.opacity(0.85)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                        .ignoresSafeArea()
                        .onTapGesture { showProfiles(false) }
                        .accessibilityHidden(true)
                        .transition(.opacity)
                }
            }
            .overlay(alignment: .topTrailing) {
                if isAvailable {
                    VStack(alignment: .trailing, spacing: 18) {
                        Button {
                            showProfiles(!isOpen)
                        } label: {
                            ProfileAvatar(photo: profiles.selected?.photo ?? launcherPhoto, side: 48)
                                .foregroundStyle(.white.opacity(0.85))
                                .contentShape(.circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isOpen ? "Close Profiles" : "Profiles")
                        .accessibilityValue(profiles.selected?.name ?? "")
                        .accessibilityIdentifier("home-profile")
                        if isOpen {
                            profileGrid(profiles)
                                .transition(.opacity)
                        }
                    }
                    .padding(inset)
                    .foregroundStyle(.white)
                    .accessibilityAction(.escape) { showProfiles(false) }
                }
            }
            .sheet(isPresented: $addingUser) {
                AddPanelProfile(cancel: { addingUser = false }, save: add)
                    .preferredColorScheme(.dark)
                    .padding(28)
                    .frame(idealWidth: 380)
                    .presentationSizing(.fitted)
            }
            .onChange(of: isAvailable) { _, available in
                if !available {
                    showingProfiles = false
                    addingUser = false
                }
            }
    }

    private var launcherPhoto: Data {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["PANEL_PROFILE_PREVIEW"],
           let data = try? Data(contentsOf: URL(fileURLWithPath: path)) { return data }
        #endif
        return legacyPhoto
    }

    private func showProfiles(_ showing: Bool) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
            showingProfiles = showing
        }
    }

    private func profileGrid(_ profiles: PanelProfiles) -> some View {
        let side: CGFloat = sizeClass == .compact ? 72 : 96
        let columnWidth = side + 16
        let spacing: CGFloat = 22
        let columns = Array(repeating: GridItem(.fixed(columnWidth), spacing: spacing), count: 2)
        let tiles = GlassEffectContainer(spacing: spacing) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: spacing) {
                ForEach(profiles.users) { user in
                    profileTile(user, selected: user.id == profiles.selectedID, side: side)
                }
                Button {
                    addingUser = true
                } label: {
                    VStack(spacing: 10) {
                        Image(systemName: "plus")
                            .font(.system(size: side * 0.32, weight: .medium))
                            .frame(width: side, height: side)
                            .glassEffect(.regular.tint(.white.opacity(0.1)).interactive(), in: .circle)
                        Text("Add User").font(.subheadline.weight(.medium))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("profile-add")
            }
            .padding(.vertical, 3)
        }
        return VStack(alignment: .leading, spacing: 18) {
            Text("Profiles")
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            ViewThatFits(in: .vertical) {
                tiles.fixedSize(horizontal: false, vertical: true)
                ScrollView { tiles }
                    .scrollBounceBehavior(.basedOnSize)
            }
        }
        .frame(width: columnWidth * 2 + spacing)
    }

    private func profileTile(_ user: PanelProfile, selected: Bool, side: CGFloat) -> some View {
        Button {
            var updated = profiles
            updated.selectedID = user.id
            persist(updated)
            showProfiles(false)
        } label: {
            VStack(spacing: 10) {
                ProfileAvatar(photo: user.photo, side: side)
                    .overlay { Circle().strokeBorder(.white.opacity(0.16)) }
                    .overlay(alignment: .topTrailing) {
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.bold))
                                .frame(width: 26, height: 26)
                                .background(.green, in: .circle)
                                .accessibilityHidden(true)
                        }
                    }
                Text(user.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
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
            Text("Add User")
                .font(.title2.bold())
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)

            PhotosPicker(selection: $selection, matching: .images) {
                VStack(spacing: 8) {
                    ProfileAvatar(photo: photo ?? Data(), side: 80)
                        .overlay {
                            if selection != nil && imported?.item != selection {
                                ProgressView().accessibilityLabel("Loading photo")
                            }
                        }
                    Text(photo == nil ? "Choose Photo" : "Change Photo")
                        .font(.subheadline.weight(.medium))
                }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("profile-photo")
            if let imported, imported.item == selection, imported.photo == nil {
                Text("Couldn’t load this photo. Choose another.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

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
                    .tint(.blue)

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
