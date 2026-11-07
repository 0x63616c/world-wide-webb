import SwiftUI
import PanelKit

/// The camera and its booth-only gallery open directly from the launcher.
struct LivePhotoBoothModule: View {
    let camera: PhotoBoothCameraModel
    let photos: LivePhotosProvider
    let close: () -> Void
    @State private var gallery = false
    @State private var selection: LivePhoto.ID?
    @State private var showSavedStrip = false
    @State private var confirmDiscard = false
    @Environment(\.scenePhase) private var scenePhase

    private var boothPhotos: [LivePhoto] {
        photos.frames.filter { $0.groupID != nil && $0.collection == "booth-photos" }
    }

    var body: some View {
        Group {
            if gallery {
                ZStack {
                    PhotoBoothGallery(provider: photos, photos: boothPhotos, back: back) { selection = $0 }
                        .opacity(selection == nil ? 1 : 0)
                        .allowsHitTesting(selection == nil)
                        .accessibilityHidden(selection != nil)
                    if selection != nil {
                        PhotoBoothViewer(provider: photos, photos: boothPhotos, selection: $selection, back: back)
                    }
                }
            } else if showSavedStrip, let image = camera.preview {
                savedStrip(image)
            } else {
                PhotoBoothCameraPage(camera: camera, provider: photos, latest: boothPhotos.first,
                    close: back, openGallery: { gallery = true })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
        .foregroundStyle(.white)
        .accessibilityElement(children: .contain).accessibilityIdentifier("photo-booth-page")
        .task(id: !gallery && !showSavedStrip && scenePhase == .active) {
            await camera.activate(!gallery && !showSavedStrip && scenePhase == .active)
        }
        .onAppear { photos.openBooth() }
        .task { await photos.refresh() }
        .onDisappear {
            leaveBooth()
            Task { [camera] in await camera.activate(false) }
        }
        .onChange(of: camera.saved) { _, saved in
            if saved && camera.mode == .strip { showSavedStrip = true }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { photos.openBooth(); Task { await photos.refresh() } }
            else if phase == .background || !camera.requestingPermission { leaveBooth() }
        }
        .confirmationDialog("Discard the unsaved photo?", isPresented: $confirmDiscard) {
            Button("Discard", role: .destructive) { camera.discard(); close() }
        }
    }

    private func leaveBooth() {
        gallery = false
        selection = nil
        showSavedStrip = false
        camera.dismissSavedPreview()
        photos.closeBooth()
    }

    private func back() {
        if selection != nil { selection = nil }
        else if gallery { gallery = false }
        else if showSavedStrip { finishStrip() }
        else if camera.hasUnsavedPhoto { confirmDiscard = true }
        else { close() }
    }

    private func finishStrip() {
        showSavedStrip = false
        camera.dismissSavedPreview()
    }

    private func savedStrip(_ image: UIImage) -> some View {
        VStack(spacing: 16) {
            PhotoBoothBar(back: back) {
                Label("Strip saved", systemImage: "checkmark").font(.headline)
            }
            GeometryReader { geometry in
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .accessibilityLabel("Four-frame photo strip")
                    .accessibilityIdentifier("booth-capture-preview")
            }
            HStack(spacing: 12) {
                Button("View gallery") { finishStrip(); gallery = true }
                    .buttonStyle(.glass).accessibilityIdentifier("booth-gallery")
                Button(action: finishStrip) {
                    Text("Done").foregroundStyle(.black)
                }.buttonStyle(.glassProminent).tint(.white)
            }.controlSize(.large).padding(.bottom, 24)
        }
    }
}
