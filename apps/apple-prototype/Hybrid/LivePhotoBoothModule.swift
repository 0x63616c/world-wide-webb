import SwiftUI
import PanelKit

/// The existing booth manifest is private: a fresh PIN protects each opening.
struct LivePhotoBoothModule: View {
    let photos: LivePhotosProvider
    let close: () -> Void
    let camera: PhotoBoothCameraModel
    @State private var authorized = false
    @State private var gallery = false
    @State private var selected: LivePhoto?
    @State private var confirmDiscard = false
    @State private var authorizationNotice: String?
    @Environment(\.scenePhase) private var scenePhase

    init(camera: PhotoBoothCameraModel, photos: LivePhotosProvider, close: @escaping () -> Void) {
        self.camera = camera; self.photos = photos; self.close = close
    }

    private var boothPhotos: [LivePhoto] {
        photos.frames.filter { $0.groupID != nil && $0.collection == "booth-photos" }
    }
    var body: some View {
        VStack(spacing: 0) {
            Group {
                if !authorized {
                    PanelPINEntry(title: "Photo Booth", notice: authorizationNotice) { pin in
                        let accepted = await photos.unlock(pin: pin)
                        authorized = accepted
                        if accepted { authorizationNotice = nil }
                        return accepted ? nil : photos.error ?? "PIN not accepted. Try again."
                    }
                } else if let selected { detail(selected) }
                else if gallery { galleryPage }
                else { cameraPage }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }.safeAreaInset(edge: .top, spacing: 0) { PanelAppNavigationBar(back: back) }
            .background(.black).foregroundStyle(.white)
            .accessibilityElement(children: .contain).accessibilityIdentifier("photo-booth-page")
            .task(id: "\(authorized)-\(gallery)-\(scenePhase == .active)") {
                await camera.activate(authorized && !gallery && scenePhase == .active)
            }
            .task(id: authorized) { if authorized { await photos.refresh() } }
            .onDisappear { lock(); Task { [camera] in await camera.activate(false) } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background || (phase == .inactive && !camera.requestingPermission) { lock() }
            }
            .onChange(of: photos.unlocked) { _, unlocked in
                if !unlocked && authorized {
                    authorized = false; gallery = false; selected = nil
                    authorizationNotice = "Photos couldn’t be loaded. Unlock to try again."
                }
            }
            .confirmationDialog("Discard the unsaved photo?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { camera.discard(); close() }
            }
    }
    private func lock() { authorized = false; gallery = false; selected = nil; photos.lock() }
    private func back() {
        guard authorized else { close(); return } // A locked page cannot discard someone else's pending photo.
        if selected != nil { selected = nil }
        else if gallery { gallery = false }
        else if camera.hasUnsavedPhoto { confirmDiscard = true }
        else { close() }
    }
    private var cameraPage: some View {
        VStack(spacing: 24) {
            captureOptions
            ZStack {
                if let image = camera.preview {
                    Image(uiImage: image).resizable().scaledToFit().accessibilityIdentifier("booth-capture-preview")
                }
                else if camera.usesTestCamera {
                    ContentUnavailableView("Simulator camera", systemImage: "camera",
                        description: Text("Test images only"))
                }
                else if camera.status == .ready, let device = camera.device {
                    PhotoBoothPreview(capture: camera.capture, device: device) { camera.rotation = $0 }
                } else {
                    switch camera.status {
                    case .starting: ProgressView()
                    case .denied:
                        ContentUnavailableView {
                            Label("Camera access is off", systemImage: "camera")
                        } actions: {
                            Button("Open Settings") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }.buttonStyle(.glass)
                        }
                    case .unavailable: ContentUnavailableView("Camera unavailable", systemImage: "camera",
                        description: Text("This device has no camera."))
                    default:
                        ContentUnavailableView {
                            Label("Camera unavailable", systemImage: "camera")
                        } actions: { Button("Try again") { Task { await camera.activate(true) } }.buttonStyle(.glass) }
                    }
                }
                if camera.countdown > 0 {
                    Text(String(camera.countdown)).font(.system(size: 120, weight: .semibold, design: .rounded))
                        .shadow(color: .black.opacity(0.6), radius: 10)
                        .accessibilityIdentifier("booth-countdown")
                }
                if camera.saved {
                    Label("Saved", systemImage: "checkmark.circle.fill").font(.title2.weight(.semibold))
                        .padding(20).glassEffect(.regular, in: .capsule)
                } else if camera.saving { ProgressView().controlSize(.large) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white.opacity(0.04)).clipShape(.rect(cornerRadius: 32))
                .overlay(alignment: .topTrailing) {
                    if camera.capturing && camera.mode == .strip {
                        Text("\(camera.shotNumber) / 4").font(.title3.monospacedDigit().weight(.semibold))
                            .padding(.horizontal, 20).padding(.vertical, 12).glassEffect(.regular, in: .capsule)
                            .accessibilityLabel("Photo \(camera.shotNumber) of 4")
                            .accessibilityIdentifier("booth-shot-progress").padding(20)
                    }
                }
            if let error = camera.error {
                HStack(spacing: 20) {
                    Text(error).foregroundStyle(.secondary)
                    if camera.hasUnsavedPhoto {
                        Button("Retry save") { camera.retrySave() }.buttonStyle(.glass)
                        Button("Retake", action: camera.discard).buttonStyle(.glass)
                    }
                }.accessibilityIdentifier("booth-error")
            }
            HStack {
                Button { gallery = true } label: {
                    Label("Booth photos", systemImage: "photo.stack").labelStyle(.iconOnly)
                        .font(.system(size: 26)).frame(width: 64, height: 64)
                }.buttonStyle(.glass).buttonBorderShape(.circle).accessibilityIdentifier("booth-gallery")
                Spacer()
                Button(action: camera.shutter) {
                    ZStack {
                        Circle().strokeBorder(.white, lineWidth: 4).frame(width: 88, height: 88)
                        if camera.capturing { Image(systemName: "xmark").font(.title) }
                        else { Circle().fill(.white).frame(width: 72, height: 72) }
                    }
                }.buttonStyle(.plain).disabled(camera.status != .ready || camera.saving || camera.hasUnsavedPhoto)
                    .opacity(camera.status == .ready ? 1 : 0.3)
                    .accessibilityLabel(camera.capturing ? "Cancel capture" : camera.mode == .strip ? "Take photo strip" : "Take photo")
                    .accessibilityHint(camera.mode == .strip ? "Takes four photos with time to pose between them" : "Uses the selected self-timer")
                    .accessibilityIdentifier("booth-shutter")
                Spacer()
                Color.clear.frame(width: 88, height: 64).accessibilityHidden(true)
            }.frame(height: 96)
        }.padding(.horizontal, 48).padding(.bottom, 32)
            .accessibilityElement(children: .contain).accessibilityIdentifier("booth-camera")
    }
    private var captureOptions: some View {
        GlassEffectContainer {
            HStack {
                Color.clear.frame(width: 100, height: 1).accessibilityHidden(true)
                Spacer()
                Picker("Capture mode", selection: Binding(get: { camera.mode }, set: { camera.mode = $0 })) {
                    ForEach(PhotoBoothCameraModel.Mode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }.pickerStyle(.segmented).frame(width: 260).controlSize(.large)
                    .accessibilityIdentifier("booth-mode")
                Spacer()
                Menu {
                    Picker("Self-timer", selection: Binding(get: { camera.timerSeconds }, set: { camera.timerSeconds = $0 })) {
                        ForEach(PhotoBoothCameraModel.timerOptions, id: \.self) { seconds in
                            Text(seconds == 0 ? "Off" : "\(seconds) seconds").tag(seconds)
                        }
                    }
                } label: {
                    Label(camera.timerSeconds == 0 ? "Off" : "\(camera.timerSeconds)s", systemImage: "timer")
                        .font(.title3.weight(.medium)).frame(minWidth: 76, minHeight: 48)
                }.buttonStyle(.glass).buttonBorderShape(.capsule)
                    .accessibilityLabel("Self-timer, \(camera.timerSeconds == 0 ? "off" : "\(camera.timerSeconds) seconds")")
                    .accessibilityIdentifier("booth-timer")
            }.disabled(camera.capturing || camera.saving)
        }
    }
    private var galleryPage: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Booth photos").font(.largeTitle.weight(.semibold))
            if boothPhotos.isEmpty {
                ContentUnavailableView("No booth photos yet", systemImage: "photo.stack")
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 3), spacing: 24) {
                        ForEach(boothPhotos) { photo in
                            Button { selected = photo } label: {
                                AuthenticatedPhoto(provider: photos, photo: photo).aspectRatio(4 / 3, contentMode: .fit)
                                    .clipShape(.rect(cornerRadius: 20))
                            }.buttonStyle(.plain).accessibilityLabel("Open booth photo")
                                .accessibilityIdentifier("booth-photo-\(photo.id)")
                        }
                    }
                }
            }
            if case .unavailable = photos.availability {
                Button("Couldn’t load photos. Try again") { Task { await photos.refresh() } }.buttonStyle(.glass)
            }
        }.padding(48).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .contain).accessibilityIdentifier("booth-photos")
    }
    private func detail(_ photo: LivePhoto) -> some View {
        AuthenticatedPhoto(provider: photos, photo: photo)
            .padding(32).accessibilityLabel("Booth photo").accessibilityIdentifier("booth-photo-detail")
    }
}
