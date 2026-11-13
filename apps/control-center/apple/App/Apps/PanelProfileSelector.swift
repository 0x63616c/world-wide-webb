import ImageIO
import PanelKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct PanelProfileSelector: ViewModifier {
    static let avatarSide: CGFloat = 48

    let isAvailable: Bool
    let inset: CGFloat

    @AppStorage("panel.selectedProfileID") private var selectedID = ""
    @Environment(\.homeIntegration) private var integration
    @Environment(\.panelContentInsets) private var contentInsets
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingProfiles = false
    @State private var editing: ProfileEditTarget?
    @State private var profiles: [PanelProfile] = []
    @State private var loadError: String?

    private var selected: PanelProfile? { profiles.first { $0.id == selectedID } }

    func body(content: Content) -> some View {
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
            .overlay {
                GeometryReader { geometry in
                    // Keep the avatar in the moving launcher even while Home is offscreen.
                    VStack(alignment: .trailing, spacing: 18) {
                        Button {
                            showProfiles(!isOpen)
                        } label: {
                            ProfileAvatar(photo: selected?.photo ?? launcherPhoto, side: Self.avatarSide)
                                .foregroundStyle(.white.opacity(0.85))
                                .contentShape(.circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isOpen ? "Close Profiles" : "Profiles")
                        .accessibilityValue(selected?.name ?? "")
                        .accessibilityIdentifier("home-profile")
                        if isOpen {
                            profileGrid()
                                .transition(.opacity)
                        }
                    }
                    .padding(profileInsets(in: geometry))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .foregroundStyle(.white)
                    .allowsHitTesting(isAvailable)
                    .accessibilityHidden(!isAvailable)
                    .accessibilityAction(.escape) { showProfiles(false) }
                }
            }
            .sheet(item: $editing) { target in
                ProfileEditorSheet(
                    profile: target.profile, pin: integration?.panelPIN,
                    save: { pin, name, photo in try await save(target.profile, pin: pin, name: name, photo: photo) },
                    delete: { pin in try await remove(target.profile, pin: pin) }
                )
                .preferredColorScheme(.dark)
                .presentationSizing(.fitted)
            }
            .onChange(of: isAvailable) { _, available in
                if !available {
                    showingProfiles = false
                    editing = nil
                }
            }
            .task { await refresh() }
    }

    private func profileInsets(in geometry: GeometryProxy) -> EdgeInsets {
        let railFitsAvatar = contentInsets.trailing >= Self.avatarSide + 16
        var result = EdgeInsets(
            top: contentInsets.top + inset, leading: inset, bottom: contentInsets.bottom + inset,
            trailing: railFitsAvatar ? (contentInsets.trailing - Self.avatarSide) / 2 : contentInsets.trailing + inset)
        if #available(iOS 27.1, *) {
            let cameras = geometry.reservedRegions(kind: .occlusion).filter {
                $0.isActive && $0.frame.width > 0 && $0.frame.height > 0 && $0.frame.midX > geometry.size.width * 0.6
            }
            if let camera = cameras.max(by: { $0.frame.midX < $1.frame.midX }) {
                let below = camera.frame.maxY + camera.margins.bottom + 12
                let above = camera.frame.minY - camera.margins.top - 12 - Self.avatarSide
                let top = below + Self.avatarSide + inset <= geometry.size.height - contentInsets.bottom ? below : above
                if top >= contentInsets.top + inset {
                    result.top = top
                    result.trailing = max(inset / 2, geometry.size.width - camera.frame.midX - Self.avatarSide / 2)
                }
            }
        }
        return result
    }

    private var launcherPhoto: Data {
        #if DEBUG
            if let path = ProcessInfo.processInfo.environment["PANEL_PROFILE_PREVIEW"],
                let data = try? Data(contentsOf: URL(fileURLWithPath: path))
            {
                return data
            }
        #endif
        return Data()
    }

    private func showProfiles(_ showing: Bool) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
            showingProfiles = showing
        }
        if showing { Task { await refresh() } }
    }

    private func profileGrid() -> some View {
        let side: CGFloat = sizeClass == .compact ? 72 : 96
        let columnWidth = side + 16
        let spacing: CGFloat = 22
        let columns = Array(repeating: GridItem(.fixed(columnWidth), spacing: spacing), count: 2)
        let tiles = GlassEffectContainer(spacing: spacing) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: spacing) {
                ForEach(profiles) { user in
                    profileTile(user, selected: user.id == selectedID, side: side)
                }
                Button {
                    editing = ProfileEditTarget(profile: nil)
                } label: {
                    VStack(spacing: 10) {
                        Image(systemName: "plus")
                            .font(.system(size: side * 0.32, weight: .medium))
                            .frame(width: side, height: side)
                            .glassEffect(.regular.tint(.white.opacity(0.1)).interactive(), in: .circle)
                        Text("Add User").font(.subheadline.weight(.medium))
                    }
                    .contentShape(.rect)
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
            if let loadError {
                Text(loadError).font(.footnote).foregroundStyle(.red)
                Button("Retry") { Task { await refresh() } }.buttonStyle(.glass)
            }
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
            selectedID = user.id
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
        .accessibilityLabel("Select \(user.name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityAction(named: "Edit Profile") { editing = ProfileEditTarget(profile: user) }
        .contextMenu {
            Button("Edit Profile", systemImage: "pencil") { editing = ProfileEditTarget(profile: user) }
        }
    }

    private func refresh() async {
        guard let api = integration?.profilesAPI else { return }
        do {
            profiles = try await api.list()
            loadError = nil
            if !selectedID.isEmpty && !profiles.contains(where: { $0.id == selectedID }) { selectedID = "" }
        } catch {
            loadError = "Couldn’t load profiles."
        }
    }

    private func save(_ existing: PanelProfile?, pin: String, name: String, photo: Data) async throws {
        guard let api = integration?.profilesAPI else { throw PanelAPIError.notConfigured }
        let saved: PanelProfile
        if let existing {
            saved = try await api.update(existing.id, name: name, photo: photo, pin: pin)
        } else {
            saved = try await api.create(name: name, photo: photo, pin: pin)
        }
        if let index = profiles.firstIndex(where: { $0.id == saved.id }) {
            profiles[index] = saved
        } else {
            profiles.append(saved)
        }
        selectedID = saved.id
        await refresh()
        editing = nil
    }

    private func remove(_ existing: PanelProfile?, pin: String) async throws {
        guard let existing, let api = integration?.profilesAPI else { throw PanelAPIError.notConfigured }
        try await api.remove(existing.id, pin: pin)
        profiles.removeAll { $0.id == existing.id }
        if selectedID == existing.id { selectedID = "" }
        await refresh()
        editing = nil
    }
}

private struct ProfileEditTarget: Identifiable {
    let profile: PanelProfile?
    var id: String { profile?.id ?? "new" }
}

private struct ProfileEditorSheet: View {
    let profile: PanelProfile?
    let pin: PanelPINAPI?
    let save: (String, String, Data) async throws -> Void
    let delete: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var authorizedPIN: String?

    var body: some View {
        Group {
            if let authorizedPIN {
                EditPanelProfile(
                    profile: profile, pin: authorizedPIN, save: save, delete: delete
                )
                .padding(20)
                .fixedSize(horizontal: false, vertical: true)
            } else {
                ViewThatFits(in: .vertical) {
                    challenge.fixedSize(horizontal: false, vertical: true)
                    ScrollView { challenge }
                }
            }
        }
        .frame(idealWidth: 420, idealHeight: authorizedPIN == nil ? 700 : 310)
        .accessibilityAction(.escape) { dismiss() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { dismiss() }
        }
    }

    @ViewBuilder private var challenge: some View {
        if let pin {
            PanelPINEntry(title: "Enter Pin") { entered in
                do {
                    guard try await pin.verify(entered) else { return "PIN not accepted. Try again." }
                    guard !Task.isCancelled else { return nil }
                    authorizedPIN = entered
                    return nil
                } catch {
                    return "Couldn’t verify the PIN. Try again."
                }
            }
        } else {
            ContentUnavailableView(
                "PIN verification unavailable", systemImage: "lock",
                description: Text("Connect to the panel server to manage profiles."))
        }
    }
}

private struct EditPanelProfile: View {
    let profile: PanelProfile?
    let pin: String
    let save: (String, String, Data) async throws -> Void
    let delete: (String) async throws -> Void
    @State private var name: String
    @State private var selection: PhotosPickerItem?
    @State private var imported: (item: PhotosPickerItem, photo: Data?)?
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var confirmingDelete = false

    init(
        profile: PanelProfile?, pin: String,
        save: @escaping (String, String, Data) async throws -> Void,
        delete: @escaping (String) async throws -> Void
    ) {
        self.profile = profile
        self.pin = pin
        self.save = save
        self.delete = delete
        _name = State(initialValue: profile?.name ?? "")
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var photo: Data? {
        selection == nil ? profile?.photo : (imported?.item == selection ? imported?.photo : nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(profile == nil ? "Add User" : "Edit Profile")
                .font(.title2.bold())
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)

            PhotosPicker(selection: $selection, matching: .images) {
                ProfileAvatar(photo: photo ?? Data(), side: 80)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: photo == nil ? "plus" : "camera.fill")
                            .font(.caption.weight(.semibold))
                            .frame(width: 26, height: 26)
                            .background(.blue, in: .circle)
                            .offset(x: 4, y: 4)
                    }
                    .overlay {
                        if selection != nil && imported?.item != selection {
                            ProgressView().accessibilityLabel("Loading photo")
                        }
                    }
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(photo == nil ? "Add profile photo" : "Change profile photo")
            .accessibilityIdentifier("profile-photo")
            if let imported, imported.item == selection, imported.photo == nil {
                Text("Photo couldn’t load. Try another.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Name").font(.subheadline.weight(.medium))
                TextField("", text: $name)
                    .textContentType(.name)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 12))
                    .accessibilityLabel("Name")
                    .accessibilityIdentifier("profile-name")
            }

            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }
            Divider()
            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    if profile != nil {
                        Button("Delete", role: .destructive) { confirmingDelete = true }
                            .buttonStyle(.glass)
                            .disabled(saving)
                            .alert("Are you sure?", isPresented: $confirmingDelete) {
                                Button("Delete Profile", role: .destructive) {
                                    saving = true
                                    Task {
                                        do { try await delete(pin) } catch {
                                            errorMessage = "Couldn’t delete the profile. Try again."
                                        }
                                        saving = false
                                    }
                                }
                                Button("Cancel", role: .cancel) {}
                            }
                    }
                    Spacer()
                    Button(profile == nil ? "Add" : "Save", role: .confirm) {
                        guard let photo, !trimmedName.isEmpty else { return }
                        saving = true
                        Task {
                            do { try await save(pin, trimmedName, photo) } catch {
                                errorMessage = "Couldn’t save the profile. Try again."
                            }
                            saving = false
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.blue)

                    .disabled(trimmedName.isEmpty || photo == nil || saving)
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
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: 0.86] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }

    private static func decodeThumbnail(_ data: Data) -> CGImage? {
        guard !data.isEmpty, let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(
            source, 0,
            [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 256,
            ] as CFDictionary)
    }
}
