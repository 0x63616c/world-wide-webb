import SwiftUI
import PanelKit

/// A fresh PIN protects each opening, including access to the in-app gallery.
struct LivePhotoBoothModule: View {
    let camera: PhotoBoothCameraModel
    let photos: LivePhotosProvider
    let close: () -> Void
    @State private var authorized = false
    @State private var gallery = false
    @State private var selection: LivePhoto.ID?
    @State private var showSavedStrip = false
    @State private var confirmDiscard = false
    @State private var authorizationNotice: String?
    @Environment(\.scenePhase) private var scenePhase

    private var boothPhotos: [LivePhoto] {
        photos.frames.filter { $0.groupID != nil && $0.collection == "booth-photos" }
    }

    var body: some View {
        Group {
            if !authorized {
                PanelPINEntry(title: "Photo Booth", notice: authorizationNotice) { pin in
                    let accepted = await photos.unlock(pin: pin)
                    authorized = accepted
                    if accepted { authorizationNotice = nil }
                    return accepted ? nil : photos.error ?? "PIN not accepted. Try again."
                }
                .safeAreaInset(edge: .top, spacing: 0) { PanelAppNavigationBar(back: close) }
            } else if gallery {
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
        .task(id: authorized && !gallery && !showSavedStrip && scenePhase == .active) {
            await camera.activate(authorized && !gallery && !showSavedStrip && scenePhase == .active)
        }
        .task(id: authorized) { if authorized { await photos.refresh() } }
        .onDisappear {
            lock()
            Task { [camera] in await camera.activate(false) }
        }
        .onChange(of: camera.saved) { _, saved in
            if saved && authorized && camera.mode == .strip { showSavedStrip = true }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background || (phase == .inactive && !camera.requestingPermission) { lock() }
        }
        .onChange(of: photos.unlocked) { _, unlocked in
            if !unlocked && authorized {
                lock()
                authorizationNotice = "Photos couldn’t be loaded. Unlock to try again."
            }
        }
        .confirmationDialog("Discard the unsaved photo?", isPresented: $confirmDiscard) {
            Button("Discard", role: .destructive) { camera.discard(); close() }
        }
    }

    private func lock() {
        authorized = false
        gallery = false
        selection = nil
        showSavedStrip = false
        camera.dismissSavedPreview()
        photos.lock()
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
